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
import { DEFAULT_CONCURRENCY, predictFiles } from "../core/prediction/predictFiles";
import { collectSourceFiles, isTestFile } from "../core/sourceFiles";
import { FilePrediction } from "../core/types";
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
 * rather than per call.
 *
 * Ships here rather than being left to the calling agent's judgement because
 * that judgement is the thing it corrects: an agent that just wrote the code
 * is the worst-placed reader of it, since the reasoning that made it look
 * right is still in its context. The routing below (file count, not "is this
 * a fix" or "is this a feature") is deliberately narrower than earlier
 * drafts -- see CHANGELOG.md 0.6.0 for why, including the honest caveat that
 * the sub-agent's payoff is still an argument, not a measured result.
 */
const INSTRUCTIONS = [
    "Deterministic tools first: scan_project and analyze_file cost nothing and answer most " +
        "questions about where the risk sits. predict_failures spawns a second model, so call " +
        "it when you want a verdict independent of your own.",
    "When you point these tools at code you wrote in this session -- a fix for something they " +
        "flagged, or a feature you just finished -- have it checked from outside the context " +
        "that wrote it. Re-reading your own work in the context that produced it is the " +
        "weakest check available, because the reasoning that made it look right is still in " +
        "scope and tends to confirm itself.",
    "Which outside seat depends on how far the change reaches. A change confined to one file, " +
        "including a whole feature in one file: a fresh predict_failures on it, a second model " +
        "for one call. A change spanning several files: a sub-agent where the host has them, " +
        "because predict_failures reads each file on its own and never sees how they have to " +
        "agree. File count is the test -- not how large the change felt, and not whether it " +
        "was a fix or a feature. A clean predict_failures on new code is not a clearance -- it " +
        "means the file is locally sound, not that the feature is right.",
    "Reviewing more than one file: pass them all as `files` in a single predict_failures call. " +
        "The verdicts are independent and run concurrently, so a batch bills the same as the " +
        "same files one at a time and returns in roughly the time of the slowest one. Calling " +
        "once per file pays that wait again for every file and is the main reason this tool " +
        "feels slow.",
    "Scope the sub-agent: give it the changed files and what you were trying to do, and ask " +
        "it to review only that. An unscoped agent rebuilds the project from cold and reports " +
        "on code nobody touched, which is what makes this expensive. Where the host can run it " +
        "in the background, do not block on it: this is a second opinion on work already " +
        "done, not a gate the next step waits behind. Do this at minimum for actionable " +
        "findings and for changes that span files, and use your judgement above that. A " +
        "mechanical fix -- a typo, a missing await, an off-by-one with one correct value -- " +
        "needs neither seat."
].join("\n\n");

const server = new McpServer(
    {
        name: "predictive-debugger",
        version: typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev"
    },
    { instructions: INSTRUCTIONS }
);

/**
 * Serialise a reply, compactly -- not pretty-printed. The reader is a model,
 * and a two-space indent cost 46 of the 161 tokens in a typical
 * `predict_failures` reply, 29% spent on formatting nobody reads.
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

/* ---- Deterministic tools: no model call, no credentials, milliseconds. ---- */

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
            "Walk a directory and rank its JavaScript/TypeScript files by risk density — " +
            "how concentrated the failure-prone code is, not how big the file is. " +
            "Test files are left out by default; pass includeTests to rank them too. " +
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
                .describe("Include the raw metric counts for every file (default false)"),
            includeTests: z
                .boolean()
                .optional()
                .describe(
                    "Rank test files too — *.spec.*, *.test.*, and anything under " +
                        "__tests__/test/tests/spec/__mocks__ (default false). They rank high " +
                        "for a structural reason rather than a real one: mocked awaits read " +
                        "as async complexity. Turn this on to audit a suite's own complexity."
                )
        }
    },
    async ({ directory, limit, verbose, includeTests }) => {
        try {
            const root = path.resolve(directory);
            const walked = await collectSourceFiles(root);
            // Filtered here, not in the walker: the VS Code project-wide
            // command still covers tests, and only this ranking opts out.
            const files = includeTests
                ? walked
                : walked.filter((file) => !isTestFile(path.relative(root, file)));
            const excludedTests = walked.length - files.length;
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
                // Only when something was actually withheld: silence would
                // leave a caller wondering why the spec file it expected to
                // see is missing, and a zero would cost every other reply.
                ...(excludedTests > 0 ? { excludedTests } : {}),
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

/* ---- Model-backed tool: spawns a CLI, slow and billed. ---- */

/**
 * The per-file body of a `predict_failures` reply, shared by the single-file
 * and batch shapes so the two cannot drift.
 */
function predictionBody(
    file: string,
    result: FilePrediction,
    options: { verbose?: boolean; logFile?: string }
) {
    // Verbose fields are opt-in: the verdict alone is ~70 tokens, a fifth of
    // the old always-on reply. See bench/RESULTS.md section 1.
    const { findings, truncated, checked } = result.ai;
    const [top, ...rest] = findings;

    return {
        file, // echoed as given, not resolved -- the caller already knows the path
        pattern: top.pattern,
        score: top.score,
        line: top.line ?? null,
        reason: top.reason,
        status: assessmentStatus(result.ai),
        actionable: isActionablePrediction(top),
        // A second demonstrable finding is dropped only if this is omitted.
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
        // Always present, even empty: an empty list is itself the signal that
        // no coverage was reported, and `verbose` would hide that.
        checked: checked ?? [],
        combinedScore: round(result.combinedScore),
        staticRisk: round(result.riskScore),
        ...(truncated ? { truncated } : {}),
        ...(options.verbose ? { metrics: result.metrics, logs: result.logs } : {}),
        ...(!options.verbose && options.logFile ? { logAnomalies: result.logs.anomalyCount } : {})
    };
}

/**
 * The verification rule restated on the wire: `instructions` is sent once at
 * initialize and not every client forwards it to the model, but a tool result
 * always reaches it. Always present, not gated on the precision gate -- a
 * clean reply on code the agent just wrote is the turn this matters most and
 * is least likely to be remembered as needing it.
 */
function reviewHint(results: FilePrediction[]): string {
    return results.some((result) => actionableFindings(result.ai).length > 0)
        ? "verify the fix outside this context unless mechanical"
        : "clean file, not a cleared feature -- review new code outside this context";
}

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
            "This spawns another model and takes 5-15 seconds, so only call it " +
            "when you specifically want an independent second opinion. If you are yourself " +
            "reviewing the code, use analyze_file and read the source instead. " +
            "Reviewing several files? Pass them all as `files` in one call rather than " +
            "calling once per file: the verdicts run concurrently, so the batch costs the " +
            "same and takes about as long as a single file.",
        inputSchema: {
            file: z
                .string()
                .optional()
                .describe("Absolute path to a .js/.jsx/.ts/.tsx file"),
            files: z
                .array(z.string())
                .optional()
                .describe(
                    "Absolute paths to review in one call, run concurrently. Prefer this " +
                        "over one call per file when checking a change set: the verdicts are " +
                        "independent, so a batch bills the same as the same files one at a " +
                        "time but finishes in roughly the time of the slowest one. Replies " +
                        "carry a `results` array in the order given. Supersedes `file`."
                ),
            concurrency: z
                .number()
                .int()
                .min(1)
                .max(8)
                .optional()
                .describe(
                    `Verdicts in flight at once for a batch (default ${DEFAULT_CONCURRENCY}). ` +
                        "Lower it if the provider starts rate-limiting."
                ),
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
    async ({ file, files, concurrency, provider, model, logFile, verbose, calleeContext, multi }) => {
        const batched = Boolean(files && files.length > 0);
        const requested = batched ? files! : file ? [file] : [];
        if (requested.length === 0) {
            return failure("predict_failures needs either `file` or a non-empty `files` array.");
        }

        // Deduplicated on the resolved path, keyed back to what the caller
        // wrote, so "./a.js" and its absolute form don't get billed twice but
        // the reply still echoes the path as given.
        const givenFor = new Map<string, string>();
        for (const entry of requested) {
            const resolved = path.resolve(entry);
            if (!givenFor.has(resolved)) {
                givenFor.set(resolved, entry);
            }
        }
        const targets = [...givenFor.keys()];

        try {
            const active = await registry.resolveActive(provider as ProviderId | undefined);
            const options = {
                provider: active.provider,
                location: active.location,
                model,
                calleeContext,
                multi,
                logs: logFile ? { logPath: path.resolve(logFile) } : undefined
            };

            // Forks on which parameter was used, not on how many targets
            // survived deduplication -- a caller shouldn't have to guess
            // whether its paths collapsed to know the reply's shape. `file`
            // keeps the flat reply it always had.
            if (!batched) {
                const result = await predictFile(targets[0], options);
                return json({
                    ...predictionBody(givenFor.get(targets[0])!, result, { verbose, logFile }),
                    review: reviewHint([result]),
                    viaProvider: active.provider.id
                });
            }

            const { results, failures } = await predictFiles(targets, {
                ...options,
                concurrency
            });

            return json({
                results: results.map((result) =>
                    predictionBody(givenFor.get(result.file) ?? result.file, result, {
                        verbose,
                        logFile
                    })
                ),
                review: reviewHint(results), // hoisted: identical for every entry
                viaProvider: active.provider.id,
                ...(failures.length > 0
                    ? {
                          failures: failures.map((entry) => ({
                              file: givenFor.get(entry.file) ?? entry.file,
                              reason: entry.reason
                          }))
                      }
                    : {})
            });
        } catch (err) {
            const subject = targets.length === 1 ? givenFor.get(targets[0])! : `${targets.length} files`;
            return failure(`Prediction failed for ${subject}: ${message(err)}`);
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
