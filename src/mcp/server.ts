import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeFile } from "../core/analysis/risk";
import { analyzeLogs } from "../core/logs/analyzeLogs";
import {
    actionableFindings,
    assessmentStatus,
    isActionablePrediction,
    MIN_ACTIONABLE_SCORE,
    predictionStatus
} from "../core/prediction/confidence";
import { predictFile } from "../core/prediction/predictFile";
import { collectSourceFiles } from "../core/sourceFiles";
import { ProviderRegistry } from "../providers/registry";
import { ProviderId } from "../providers/types";

/**
 * Injected by esbuild from package.json. Declared rather than imported because
 * the tsc build in `out/` emits no JSON; `typeof` on an undeclared name is safe
 * in JavaScript, so the fallback applies there instead of throwing.
 */
declare const __PACKAGE_VERSION__: string | undefined;

const registry = new ProviderRegistry();

/**
 * Advertised once at initialize, so a session pays for this prose one time
 * rather than per call, and a client that ignores the field pays nothing.
 *
 * The verification rule ships here rather than being left to the calling
 * agent's judgement because that judgement is the thing it corrects. An agent
 * that has just written a fix is the worst-placed reader of it: the reasoning
 * that made the fix look right is still in its context, so a second look from
 * the same seat re-derives the first one instead of testing it. Leaving the
 * rule to each user's own project instructions means only the users who
 * already knew about the failure mode get the benefit.
 *
 * It is a floor, not a ceiling. "At minimum" leaves the agent free to verify
 * more often than the rule requires, and the mechanical-fix exemption is what
 * stops it from doubling the cost of correcting a typo.
 */
const INSTRUCTIONS = [
    "Deterministic tools first: scan_project and analyze_file cost nothing and answer most " +
        "questions about where the risk sits. predict_failures spawns a second model, so call " +
        "it when you want a verdict independent of your own.",
    "When you fix something these tools flagged, and the fix involved choosing between " +
        "approaches rather than being mechanical, have the change reviewed from outside the " +
        "context that produced it: a sub-agent where the host has them, otherwise a fresh " +
        "predict_failures on the edited file. Re-reading your own fix in the context that " +
        "wrote it is the weakest check available, because the reasoning that made it look " +
        "right is still in scope and tends to confirm itself. Do this at minimum for " +
        "actionable findings, and use your judgement above that. A mechanical fix -- a typo, " +
        "a missing await, an off-by-one with one correct value -- does not need it."
].join("\n\n");

const server = new McpServer(
    {
        name: "predictive-debugger",
        version: typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev"
    },
    { instructions: INSTRUCTIONS }
);

/**
 * Serialise a reply, compactly.
 *
 * The reader is a model, and every space and newline in the indentation is
 * billed to it. Two-space indent cost 46 of the 161 tokens in a typical
 * `predict_failures` reply -- 29% of the response, spent entirely on making the
 * raw transcript pleasant for a human who is not the audience. Pretty-printing
 * an array is the worst of it: `checked` puts each pattern id on its own
 * indented line, which is most of what the coverage field appeared to cost when
 * it was added.
 *
 * This is the whole point of the tool. It is worth calling instead of reading
 * the file only while the answer is much smaller than the file, so the
 * response budget is the product, not a detail of it.
 */
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** Two decimals is all the precision these heuristics have, and it is shorter. */
function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function failure(message: string) {
    return {
        content: [{ type: "text" as const, text: message }],
        isError: true
    };
}

/* ------------------------------------------------------------------ *
 * Deterministic tools: no model call, no credentials, milliseconds.
 * These are the ones a reviewing agent should reach for.
 * ------------------------------------------------------------------ */

server.registerTool(
    "analyze_file",
    {
        title: "Analyze one source file",
        description:
            "Return static complexity metrics and a heuristic risk score (0-1) for a single " +
            "JavaScript or TypeScript file. Deterministic and fast — no model call. " +
            "Call this when reviewing a file to find out where the structural risk sits " +
            "(nested loops, long functions, async boundaries, unguarded mutation) before " +
            "reading the whole file yourself.",
        inputSchema: {
            file: z.string().describe("Absolute path to a .js/.jsx/.ts/.tsx file")
        }
    },
    async ({ file }) => {
        try {
            return json(await analyzeFile(path.resolve(file)));
        } catch (err) {
            return failure(`Could not analyze ${file}: ${message(err)}`);
        }
    }
);

server.registerTool(
    "scan_project",
    {
        title: "Rank a project's files by risk",
        description:
            "Walk a directory and rank every JavaScript/TypeScript file by risk density — " +
            "how concentrated the failure-prone code is, not how big the file is. " +
            "Deterministic and fast — no model call. " +
            "Call this at the start of a code review to decide which files are worth your " +
            "attention, instead of reading the tree in arbitrary order.",
        inputSchema: {
            directory: z.string().describe("Absolute path to the directory to scan"),
            limit: z
                .number()
                .int()
                .positive()
                .max(500)
                .optional()
                .describe("Maximum number of files to return (default 50)"),
            verbose: z
                .boolean()
                .optional()
                .describe("Include the raw metric counts for every file (default false)")
        }
    },
    async ({ directory, limit, verbose }) => {
        try {
            const root = path.resolve(directory);
            const files = await collectSourceFiles(root);
            const analyses = await Promise.all(
                files.map((file) =>
                    analyzeFile(file).catch((err) => ({
                        file,
                        error: message(err)
                    }))
                )
            );

            // Ranked by density rather than by the size-driven total: the agent
            // pays per token, so "most risk per line read" is the ordering that
            // spends its budget best. See bench/RESULTS.md section 5.
            const ranked = analyses
                .filter((entry): entry is Awaited<ReturnType<typeof analyzeFile>> => "riskScore" in entry)
                .sort((a, b) => b.riskDensity - a.riskDensity)
                .slice(0, limit ?? 50);

            return json({
                scanned: files.length,
                returned: ranked.length,
                orderedBy: "riskDensity",
                // Paths are echoed relative to the scanned root and the metric
                // counts are dropped by default: this output lands whole in the
                // caller's context, and the same numbers are already spelled out
                // in `signals`.
                files: ranked.map((entry) => ({
                    file: path.relative(root, entry.file).replace(/\\/g, "/"),
                    riskDensity: round(entry.riskDensity),
                    riskScore: round(entry.riskScore),
                    lines: entry.metrics.lines,
                    signals: entry.signals,
                    ...(verbose ? { metrics: entry.metrics } : {}),
                    ...(entry.parseError ? { parseError: entry.parseError } : {})
                }))
            });
        } catch (err) {
            return failure(`Could not scan ${directory}: ${message(err)}`);
        }
    }
);

server.registerTool(
    "analyze_logs",
    {
        title: "Find anomalous log lines",
        description:
            "Score a log file's lines by severity and how unusual their wording is, and " +
            "return the anomalies, worst first. Deterministic — no model call, no API key. " +
            "Call this when you have a log file and want the handful of lines worth reading " +
            "rather than the whole file.",
        inputSchema: {
            logFile: z.string().describe("Absolute path to the log file"),
            threshold: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe("Anomaly score cutoff, 0-1 (default 0.5)")
        }
    },
    async ({ logFile, threshold }) => {
        const result = await analyzeLogs({
            logPath: path.resolve(logFile),
            threshold
        });
        return result.skipped ? failure(result.skipped) : json(result);
    }
);

/* ------------------------------------------------------------------ *
 * Model-backed tool. Spawns the Claude/Codex/Copilot CLI, so it is slow and
 * billed. An agent calling this is asking a second model to do work it
 * could do itself — hence the explicit "only if" in the description.
 * ------------------------------------------------------------------ */

server.registerTool(
    "predict_failures",
    {
        title: "Predict the most likely runtime failure in a file",
        description:
            "Combine static analysis with a second-opinion verdict from the signed-in " +
            "Claude Code, Codex, or GitHub Copilot CLI, returning the most likely runtime " +
            "failure with a line number and reason. `status` distinguishes actionable, " +
            "uncertain, no-finding, and unavailable results. `checked` lists the bug " +
            "categories the model reports having considered, so a clean file weighed " +
            "against the whole catalogue is distinguishable from one where it stopped " +
            "early; it is a self-report, and an empty list means no coverage was " +
            "reported. Pass `multi: true` to get every " +
            "finding the model can demonstrate, ranked, in a `findings` array instead of " +
            "one verdict — experimental, and more findings per call is also more surface " +
            "for false positives per call. Treat it as a defect only when " +
            "`actionable` is true; " +
            `that applies the measured score >= ${MIN_ACTIONABLE_SCORE} precision gate. ` +
            "This spawns another model and takes 5-15 seconds per file, so only call it " +
            "when you specifically want an independent second opinion. If you are yourself " +
            "reviewing the code, use analyze_file and read the source instead.",
        inputSchema: {
            file: z.string().describe("Absolute path to a .js/.jsx/.ts/.tsx file"),
            provider: z
                .enum(["claude", "codex", "copilot"])
                .optional()
                .describe("Which CLI to ask (default: whichever is installed)"),
            model: z.string().optional().describe("Model override passed to the CLI"),
            calleeContext: z
                .boolean()
                .optional()
                .describe(
                    "Also send the definitions of imported functions the file calls, one " +
                        "level deep, so the model can see whether a callee already handles " +
                        "the case it is about to flag (default true). Turning this off is " +
                        "cheaper per call and measurably less accurate."
                ),
            multi: z
                .boolean()
                .optional()
                .describe(
                    "Return every finding the model can demonstrate, ranked by score, " +
                        "rather than the single most likely one (default false). " +
                        "Experimental: the precision gate was measured on one-finding " +
                        "replies, so `actionable` is less well characterised here."
                ),
            logFile: z
                .string()
                .optional()
                .describe("Optional log file to fold into the combined score"),
            verbose: z
                .boolean()
                .optional()
                .describe(
                    "Include the static metric counts and the full log breakdown (default false)"
                )
        }
    },
    async ({ file, provider, model, logFile, verbose, calleeContext, multi }) => {
        try {
            const active = await registry.resolveActive(provider as ProviderId | undefined);
            const result = await predictFile(path.resolve(file), {
                provider: active.provider,
                location: active.location,
                model,
                calleeContext,
                multi,
                logs: logFile ? { logPath: path.resolve(logFile) } : undefined
            });

            // The point of this tool is to cost the caller less context than
            // reading the file would. Measured on bench/corpus, the verdict is
            // about a fifth of the response: the rest was the metric block, a
            // log stanza saying log analysis was not requested, and the absolute
            // path the caller had just supplied. All three are now opt-in, which
            // moves the break-even point down to files of roughly 70 tokens.
            const { findings, truncated, checked } = result.ai;
            const [top, ...rest] = findings;

            return json({
                // Echoed as given rather than resolved: shorter, and the caller
                // already knows which file it asked about.
                file,
                // The top finding stays at the top level whatever the mode. A
                // caller that asked one question gets one answer, and the array
                // is there for the caller that asked for the list.
                pattern: top.pattern,
                score: top.score,
                line: top.line ?? null,
                reason: top.reason,
                status: assessmentStatus(result.ai),
                actionable: isActionablePrediction(top),
                // Emitted when there is more than one finding even if `multi`
                // was not set: a model that volunteers a second demonstrable
                // defect has done work, and dropping it silently would be the
                // one-per-file behaviour this replaced.
                ...(rest.length > 0
                    ? {
                          findings: findings.map((finding) => ({
                              pattern: finding.pattern,
                              score: finding.score,
                              line: finding.line ?? null,
                              reason: finding.reason,
                              status: predictionStatus(finding),
                              actionable: isActionablePrediction(finding)
                          }))
                      }
                    : {}),
                // The verification rule restated on the wire, in four words.
                // `instructions` is advertised once at initialize and not every
                // client forwards it to the model, whereas a tool result always
                // reaches it -- and this is the turn where the rule applies,
                // since the agent is about to act on a finding. Gated on the
                // precision gate rather than emitted always: a clean file is
                // the common reply and should not pay for advice about a fix
                // nobody is making.
                ...(actionableFindings(result.ai).length > 0
                    ? { onFix: "verify independently unless mechanical" }
                    : {}),
                // Always present, and empty when the model named nothing:
                // being able to see that coverage was not reported is the
                // point of the field, so hiding it behind `verbose` would
                // defeat it.
                checked: checked ?? [],
                combinedScore: round(result.combinedScore),
                staticRisk: round(result.riskScore),
                viaProvider: active.provider.id,
                ...(truncated ? { truncated } : {}),
                ...(verbose ? { metrics: result.metrics, logs: result.logs } : {}),
                ...(!verbose && logFile ? { logAnomalies: result.logs.anomalyCount } : {})
            });
        } catch (err) {
            return failure(`Prediction failed for ${file}: ${message(err)}`);
        }
    }
);

server.registerTool(
    "list_providers",
    {
        title: "Show available CLI providers",
        description:
            "Report which supported CLIs (Claude Code, Codex, GitHub Copilot) are installed " +
            "and signed in. " +
            "Call this to diagnose why predict_failures is failing.",
        inputSchema: {}
    },
    async () => {
        const detected = await registry.detectAll();
        return json(
            detected.map(({ provider, location, auth }) => ({
                id: provider.id,
                label: provider.label,
                installed: Boolean(location),
                path: location?.file,
                version: location?.version,
                signedIn: auth.hasCredentials,
                credentials: auth.credentialsPath,
                hint: location ? undefined : provider.installHint
            }))
        );
    }
);

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
    // stdout is the JSON-RPC channel; anything we want to say goes to stderr.
    await server.connect(new StdioServerTransport());
    process.stderr.write("predictive-debugger MCP server ready\n");
}

main().catch((err) => {
    process.stderr.write(`predictive-debugger MCP server failed: ${message(err)}\n`);
    process.exit(1);
});
