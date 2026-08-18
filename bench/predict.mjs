/**
 * Thin CLI wrapper around the predict_failures MCP tool, so the A/B agents can
 * call it with one bash command instead of an MCP client setup.
 *
 *   node bench/predict.mjs <file>
 *
 * Prints exactly what the tool returns -- no filtering, no summarising. The
 * point of the A/B is to see what an agent does with the real answer.
 */
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

const target = process.argv[2];
if (!target) {
    console.error("usage: node bench/predict.mjs <file>");
    process.exit(2);
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
    arguments: { file: path.resolve(target), provider: "claude" }
});
await client.close();

console.log(response.content.map((part) => part.text).join(""));
process.exit(response.isError ? 1 : 0);
