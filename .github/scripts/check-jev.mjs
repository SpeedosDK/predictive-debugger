import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Exercise the shipped server and real CLI subprocess boundary without paid services.
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-jev-"));
const cli = path.join(dir, "cli.cjs");
const preload = path.join(dir, "transport.cjs");
const file = path.join(dir, "example.js");
const counter = path.join(dir, "requests.txt");
const fixtureKey = "jev-integration-fixture-key";
const client = new Client({ name: "jev-smoke", version: "1" });

try {
    await fs.writeFile(file, "export function getName(value) { return value.name; }\n");
    await fs.writeFile(cli, `
if (Object.keys(process.env).some(k => k.toUpperCase() === 'TYPESAFE_API_KEY')) process.exit(91);
if (process.argv.includes('--version')) { console.log('fixture'); process.exit(0); }
let input = '';
process.stdin.on('data', data => input += data);
process.stdin.on('end', () => {
    if (!input.includes('getName')) process.exit(92);
    console.log(JSON.stringify({result: JSON.stringify({pattern:'null-reference',score:0.9,line:1,reason:'Input can be null.'})}));
});
`);
    if (process.platform === "win32") {
        await fs.writeFile(path.join(dir, "claude.cmd"), `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`);
    } else {
        const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
        await fs.writeFile(path.join(dir, "claude"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`, { mode: 0o755 });
    }
    await fs.writeFile(preload, `
const assert = require('node:assert/strict');
global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + process.env.TYPESAFE_API_KEY);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'jev-1.13.0');
    assert.ok(body.state.source.includes('getName'));
    assert.ok(!init.body.includes(process.env.TYPESAFE_API_KEY));
    require('node:fs').appendFileSync(process.env.PD_JEV_COUNTER, 'x');
    if (body.state.source.includes('failService')) return new Response('private upstream error', {status:429});
    const answer = {type:'score',score:4,confidence:1,probabilities:{'0':0,'1':0,'2':0,'3':0,'4':1}};
    return Response.json({model:'jev-1.13.0',answers:Object.fromEntries(Object.keys(body.questions).map(id=>[id,answer])),usage:{input_tokens:100,output_tokens:10}});
};
`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !["PATH", "TYPESAFE_API_KEY", "NODE_OPTIONS"].includes(key.toUpperCase())));
    await client.connect(new StdioClientTransport({
        command: process.execPath, args: ["--require", preload, path.join(root, "dist/mcp-server.js")],
        cwd: root, env: { ...env, PATH: dir + path.delimiter + process.env.PATH,
            TYPESAFE_API_KEY: fixtureKey, PD_JEV_COUNTER: counter }
    }));
    async function predict(args) {
        const result = await client.callTool({ name: "predict_failures", arguments: { provider: "claude", ...args } });
        assert.ok(!result.isError, JSON.stringify(result));
        const text = result.content.find(entry => entry.type === "text")?.text;
        assert.ok(text && !text.includes(fixtureKey) && !text.includes("private upstream"));
        return JSON.parse(text);
    }
    const baseline = await predict({ file });
    assert.ok(!Object.hasOwn(baseline, "jev"));
    await assert.rejects(fs.readFile(counter), { code: "ENOENT" });
    const { jev, ...original } = await predict({ file, jev: true });
    assert.deepEqual(original, baseline);
    assert.equal(jev.status, "scored");
    assert.equal(jev.findings[0].findingIndex, 0);
    assert.equal(jev.findings[0].priority, 1);
    assert.deepEqual(jev.usage, { inputTokens: 100, outputTokens: 10 });
    const batch = await predict({ files: [file, file], jev: true });
    assert.equal(batch.results.length, 1);
    assert.equal(batch.results[0].jev.status, "scored");
    await fs.appendFile(file, "// failService\n");
    const failed = await predict({ file, jev: true });
    assert.deepEqual(failed.jev, { status: "unavailable", reason: "rate-limit" });
    assert.equal(failed.pattern, baseline.pattern);
    assert.equal(failed.actionable, baseline.actionable);
    assert.equal(await fs.readFile(counter, "utf8"), "xxx");
    console.log("Jev MCP OK: opt-in, scoring, batch deduplication, fallback and child credential isolation");
} finally {
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
}
