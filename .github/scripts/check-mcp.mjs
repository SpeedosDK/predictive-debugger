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

// Batching is the difference between a review of four files costing four
// round trips of provider latency and costing one, so a schema that quietly
// loses `files` is a performance regression no unit test would catch. Asserted
// on the advertised schema rather than by calling the tool, which would need
// the credentials CI does not have.
const predict = tools.find((t) => t.name === "predict_failures");
assert.ok(
    predict.inputSchema?.properties?.files,
    "predict_failures should accept a `files` batch"
);
assert.ok(
    !predict.inputSchema.required?.includes("file"),
    "`file` must be optional now that `files` can carry the request instead"
);

// The verification rule ships with the server rather than living in each
// user's project instructions, so a client that never sees it is a regression
// in the product, not a cosmetic one. Both halves are asserted: the rule
// itself, and the routing that keeps it from sending every change to a
// sub-agent, which is the half that decides whether the rule is affordable.
const instructions = client.getInstructions();
assert.ok(instructions, "server should advertise instructions");
assert.match(
    instructions,
    /checked from outside the context that wrote it/,
    "instructions should carry the verification rule"
);
assert.match(
    instructions,
    /Which outside seat depends on how far the change reaches/,
    "instructions should route between predict_failures and a sub-agent"
);
// The gate is file count and nothing softer. Every previous wording that added
// a second, judgement-shaped condition ("a feature", "correctness depends on
// what was asked for") was true of nearly all real work and turned the
// expensive seat back into the default, so the narrow phrasing is the product
// decision, not a stylistic one.
assert.match(
    instructions,
    /File count is the test/,
    "instructions should gate the sub-agent on file count, not on the kind of change"
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
