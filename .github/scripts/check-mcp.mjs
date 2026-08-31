/**
 * Smoke test for CI: start the MCP server over stdio, confirm it advertises the
 * expected tools, and confirm the deterministic ones actually return data.
 *
 * Deliberately does not touch `predict_failures` — that spawns a CLI and needs
 * credentials, which CI does not have.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import path from "node:path";

const EXPECTED_TOOLS = [
    "analyze_file",
    "analyze_logs",
    "list_providers",
    "predict_failures",
    "scan_project"
];

const client = new Client({ name: "ci-smoke", version: "1.0.0" });

await client.connect(
    new StdioClientTransport({
        command: process.execPath,
        args: [path.join("dist", "mcp-server.js")],
        cwd: process.cwd()
    })
);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
assert.deepEqual(names, EXPECTED_TOOLS, `unexpected tool list: ${names.join(", ")}`);

for (const tool of tools) {
    assert.ok(tool.description?.length > 40, `${tool.name} needs a real description`);
}

// The fix-verification rule ships with the server rather than living in each
// user's project instructions, so a client that never sees it is a regression
// in the product, not a cosmetic one.
const instructions = client.getInstructions();
assert.ok(instructions, "server should advertise instructions");
assert.match(
    instructions,
    /reviewed from outside the context that produced it/,
    "instructions should carry the fix-verification rule"
);

const analyze = await client.callTool({
    name: "analyze_file",
    arguments: {
        file: path.resolve("examples", "bug-patterns", "race-condition.js")
    }
});
assert.ok(!analyze.isError, "analyze_file returned an error");
const parsed = JSON.parse(analyze.content[0].text);
assert.ok(parsed.riskScore > 0, "expected a non-zero risk score");
assert.ok(parsed.signals.length > 0, "expected at least one risk signal");

const scan = await client.callTool({
    name: "scan_project",
    arguments: { directory: path.resolve("examples", "bug-patterns") }
});
assert.ok(!scan.isError, "scan_project returned an error");
assert.equal(JSON.parse(scan.content[0].text).scanned, 4);

await client.close();
console.log(`MCP server OK — ${names.length} tools, deterministic calls verified`);
