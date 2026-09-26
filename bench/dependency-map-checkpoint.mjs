/** Measure the real local MCP tool, including its reply and advertised metadata. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { encode } from 'gpt-tokenizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const hash = value => createHash('sha256').update(value).digest('hex');
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const output = path.resolve(here, 'results', flag('output', 'results-dependency-map.json'));
const previous = path.resolve(root, flag('baseline', '.tmp/context-checkpoint/step3-baseline/mcp-server.cjs'));
const current = path.join(root, 'dist/mcp-server.js');
const trials = Number(flag('trials', '5'));
assert.ok(Number.isInteger(trials) && trials > 0);
const manifestBytes = await fs.readFile(path.join(here, 'manifest.json'));
const manifest = JSON.parse(manifestBytes).dependencyMap;
assert.ok(manifest?.queries?.length);
const models = 0;
const records = [];
const metadata = {};
for (const [arm, bundle] of [['baseline', previous], ['candidate', current]]) {
    const client = new Client({ name: 'dependency-map-checkpoint', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bundle], cwd: root }));
    try {
        const tools = (await client.listTools()).tools;
        const instructions = client.getInstructions();
        const serialized = JSON.stringify({ tools, instructions });
        metadata[arm] = { tools, instructions, estimatedTokens: encode(serialized).length, hash: hash(serialized),
            bundleHash: hash(await fs.readFile(bundle)) };
        if (arm === 'baseline') { assert.ok(!tools.some(tool => tool.name === 'map_dependencies')); continue; }
        for (let trial = 1; trial <= trials; trial++) {
            for (const query of manifest.queries) {
                const args = { directory: path.join(here, 'corpus'), file: query.file, depth: query.depth };
                const started = performance.now();
                const reply = await client.callTool({ name: 'map_dependencies', arguments: args });
                const wallMs = performance.now() - started;
                assert.ok(!reply.isError);
                const text = reply.content[0].text;
                const result = JSON.parse(text);
                assert.equal(result.truncated, false);
                assert.equal(result.coverage.scanLimited, false);
                for (const direction of ['dependencies', 'dependents']) {
                    assert.deepEqual(result[direction].map(n => n.file).sort(), query[direction].map(f => `src/dependencies/${f}`).sort());
                    for (const neighbor of result[direction]) {
                        assert.ok(neighbor.via.length <= query.depth);
                        assert.equal(Boolean(neighbor.test), neighbor.file.endsWith('.test.ts'));
                        for (const edge of neighbor.via) assert.ok(manifest.edges.some(expected => JSON.stringify(expected) === JSON.stringify(edge)), JSON.stringify(edge));
                        const chain = neighbor.via;
                        assert.equal(chain[0].from, direction === 'dependencies' ? query.file : neighbor.file);
                        assert.equal(chain.at(-1).to, direction === 'dependencies' ? neighbor.file : query.file);
                        for (let i = 1; i < chain.length; i++) assert.equal(chain[i - 1].to, chain[i].from);
                    }
                }
                assert.deepEqual(result.unresolved.map(edge => edge.line), query.unresolvedLines);
                records.push({ trial, query, wallMs, estimatedReplyTokens: encode(text).length,
                    replyBytes: Buffer.byteLength(text), responseHash: hash(text), result });
            }
        }
    } finally { await client.close(); }
}
async function treeHashes(directory, prefix = '') {
    const result = [];
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...await treeHashes(file, `${prefix}${entry.name}/`));
        else result.push({ file: `${prefix}${entry.name}`, hash: hash(await fs.readFile(file)) });
    }
    return result;
}
const config = { trials, providerCalls: models, manifestHash: hash(manifestBytes),
    corpusHashes: await treeHashes(path.join(here, 'corpus')),
    runnerHash: hash(await fs.readFile(fileURLToPath(import.meta.url))), metadata };
const data = { config, configHash: hash(JSON.stringify(config)), measuredAt: new Date().toISOString(),
    status: 'complete', records,
    note: 'No provider was invoked. Reply and MCP metadata token estimates use gpt-tokenizer. Scan timing includes stdio overhead; the first call is cold. This is a new capability, not a before/after speed comparison.' };
try { await fs.access(output); throw Error('Output exists; choose a new experiment filename.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(output, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ queries: records.length, allMatched: true, providerCalls: models,
    metadataTokens: Object.fromEntries(Object.entries(metadata).map(([arm, value]) => [arm, value.estimatedTokens])),
    results: manifest.queries.map(query => {
        const rows = records.filter(row => row.query.file === query.file);
        const sorted = rows.map(row => row.wallMs).sort((a, b) => a - b);
        return { file: query.file, replyTokens: rows[0].estimatedReplyTokens,
            coldMs: rows[0].wallMs, medianMs: sorted[Math.floor(sorted.length / 2)],
            coverage: rows[0].result.coverage };
    }) }, null, 2));
