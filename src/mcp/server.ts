import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeFile } from "../core/analysis/risk";
import { analyzeLogs } from "../core/logs/analyzeLogs";
import { predictFile } from "../core/prediction/predictFile";
import { collectSourceFiles } from "../core/sourceFiles";
import { ProviderRegistry } from "../providers/registry";
import { ProviderId } from "../providers/types";

const registry = new ProviderRegistry();

const server = new McpServer({
    name: "predictive-debugger",
    version: "1.0.0"
});

function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
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
            "Walk a directory and rank every JavaScript/TypeScript file by heuristic risk " +
            "score, highest first. Deterministic and fast — no model call. " +
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
                .describe("Maximum number of files to return (default 50)")
        }
    },
    async ({ directory, limit }) => {
        try {
            const files = await collectSourceFiles(path.resolve(directory));
            const analyses = await Promise.all(
                files.map((file) =>
                    analyzeFile(file).catch((err) => ({
                        file,
                        error: message(err)
                    }))
                )
            );

            const ranked = analyses
                .filter((entry): entry is Awaited<ReturnType<typeof analyzeFile>> => "riskScore" in entry)
                .sort((a, b) => b.riskScore - a.riskScore)
                .slice(0, limit ?? 50);

            return json({
                scanned: files.length,
                returned: ranked.length,
                files: ranked
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
            "line number and reason. " +
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
            logFile: z
                .string()
                .optional()
                .describe("Optional log file to fold into the combined score")
        }
    },
    async ({ file, provider, model, logFile }) => {
        try {
            const active = await registry.resolveActive(provider as ProviderId | undefined);
            const result = await predictFile(path.resolve(file), {
                provider: active.provider,
                location: active.location,
                model,
                logs: logFile ? { logPath: path.resolve(logFile) } : undefined
            });
            return json({ ...result, viaProvider: active.provider.id });
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
