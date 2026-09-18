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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const [command = process.execPath, ...args] = process.argv.slice(2);

const EXPECTED_TOOLS = [
    "analyze_file",
    "analyze_logs",
    "list_providers",
    "map_dependencies",
    "predict_failures",
    "scan_project"
];

const client = new Client({ name: "ci-smoke", version: "1.0.0" });

try {
    await client.connect(
        new StdioClientTransport({
            command,
            args: args.length ? args : [path.join(root, "dist", "mcp-server.js")],
            cwd: process.cwd(),
            env: process.env
        })
    );

    assert.equal(client.getServerVersion()?.version, version);
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
    assert.equal(predict.inputSchema?.properties?.jev?.type, "boolean");
    assert.ok(!predict.inputSchema.required?.includes("jev"));
    assert.ok(!Object.keys(predict.inputSchema.properties).some(key => /api.?key|token|secret/i.test(key)),
        "credentials must not be MCP tool arguments");
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
    assert.match(instructions, /Use map_dependencies for imports, reverse imports/);
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
            file: path.join(root, "examples", "bug-patterns", "race-condition.js")
        }
    });
    assert.ok(!analyze.isError, "analyze_file returned an error");
    const parsed = JSON.parse(analyze.content[0].text);
    assert.ok(parsed.riskScore > 0, "expected a non-zero risk score");
    assert.ok(parsed.signals.length > 0, "expected at least one risk signal");

    const scan = await client.callTool({
        name: "scan_project",
        arguments: { directory: path.join(root, "examples", "bug-patterns") }
    });
    assert.ok(!scan.isError, "scan_project returned an error");
    assert.equal(JSON.parse(scan.content[0].text).scanned, 4);

    const dependencies = await client.callTool({ name: "map_dependencies", arguments: {
        directory: path.join(root, "bench/corpus"), file: "src/accuracy/late-member.ts", depth: 1
    } });
    assert.ok(!dependencies.isError, "map_dependencies returned an error");
    const neighborhood = JSON.parse(dependencies.content[0].text);
    assert.ok(neighborhood.dependencies.some(entry => entry.file === "src/accuracy/large-directory.ts"));
    assert.ok(neighborhood.dependencies.every(entry => entry.via.every(edge => edge.line > 0)));
    assert.equal(neighborhood.coverage.scanLimited, false);

    console.log(`MCP server OK — ${names.length} tools, deterministic calls verified`);
} finally {
    await client.close();
}
