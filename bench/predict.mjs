/**
 * Thin CLI wrapper around the predict_failures MCP tool, so the A/B agents can
 * call it with one bash command instead of an MCP client setup.
 *
 *   node bench/predict.mjs <file>
 *   node bench/predict.mjs <file1> <file2> ...   -- one batched call, run concurrently
 *
 * Prints exactly what the tool returns -- no filtering, no summarising. The
 * point of the A/B is to see what an agent does with the real answer.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

const targets = process.argv.slice(2);
if (targets.length === 0) {
    console.error("usage: node bench/predict.mjs <file> [file2 ...]");
    process.exit(2);
}
const resolved = targets.map((target) => path.resolve(target));

// Compliance log for bench/measure-agents.mjs: proof the tool was actually
// called, independent of how the agent reports its own work. One line per
// file even when batched, so this can't be told apart from N single calls.
if (process.env.BENCH_PREDICT_LOG) {
    fs.appendFileSync(
        process.env.BENCH_PREDICT_LOG,
        resolved.map((file) => file + os.EOL).join("")
    );
}

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "dist", "mcp-server.js")],
    cwd: repoRoot,
    stderr: "ignore"
});
const client = new Client({ name: "predictive-debugger-ab", version: "1.0.0" });

await client.connect(transport);
const response = await client.callTool({
    name: "predict_failures",
    // A single file keeps the single-file argument: this script measures what
    // the tool actually does with each shape, and collapsing every call into
    // `files` would stop testing the shape most existing callers still use.
    arguments:
        resolved.length === 1
            ? { file: resolved[0], provider: "claude" }
            : { files: resolved, provider: "claude" }
});
await client.close();

console.log(response.content.map((part) => part.text).join(""));
process.exit(response.isError ? 1 : 0);
