import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeFile } from "../core/analysis/risk";
import { analyzeLogs } from "../core/logs/analyzeLogs";
import {
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

const server = new McpServer({
    name: "predictive-debugger",
    version: typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev"
});

function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
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
 * Model-backed tool. Spawns the Claude/Codex CLI, so it is slow and
 * billed. An agent calling this is asking a second model to do work it
 * could do itself — hence the explicit "only if" in the description.
 * ------------------------------------------------------------------ */

server.registerTool(
    "predict_failures",
    {
        title: "Predict the most likely runtime failure in a file",
        description:
            "Combine static analysis with a second-opinion verdict from the signed-in " +
            "Claude Code or Codex CLI, returning the most likely runtime failure with a " +
            "line number and reason. `status` distinguishes actionable, uncertain, no-finding, " +
            "and unavailable results. Treat it as a defect only when `actionable` is true; " +
            `that applies the measured score >= ${MIN_ACTIONABLE_SCORE} precision gate. ` +
            "This spawns another model and takes 5-15 seconds per file, so only call it " +
            "when you specifically want an independent second opinion. If you are yourself " +
            "reviewing the code, use analyze_file and read the source instead.",
        inputSchema: {
            file: z.string().describe("Absolute path to a .js/.jsx/.ts/.tsx file"),
            provider: z
                .enum(["claude", "codex"])
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
    async ({ file, provider, model, logFile, verbose, calleeContext }) => {
        try {
            const active = await registry.resolveActive(provider as ProviderId | undefined);
            const result = await predictFile(path.resolve(file), {
                provider: active.provider,
                location: active.location,
                model,
                calleeContext,
                logs: logFile ? { logPath: path.resolve(logFile) } : undefined
            });

            // The point of this tool is to cost the caller less context than
            // reading the file would. Measured on bench/corpus, the verdict is
            // about a fifth of the response: the rest was the metric block, a
            // log stanza saying log analysis was not requested, and the absolute
            // path the caller had just supplied. All three are now opt-in, which
            // moves the break-even point down to files of roughly 70 tokens.
            const { pattern, score, line, reason, truncated } = result.aiPrediction;

            return json({
                // Echoed as given rather than resolved: shorter, and the caller
                // already knows which file it asked about.
                file,
                pattern,
                score,
                line: line ?? null,
                reason,
                status: predictionStatus(result.aiPrediction),
                actionable: isActionablePrediction(result.aiPrediction),
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
            "Report which supported CLIs (Claude Code, Codex) are installed and signed in. " +
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
