/** Profile existing batch preparation without changing production caching or calling a model. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const output = path.resolve(here, process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
    ?? 'results-batch-parsing.json');
try { await fs.access(output); throw Error('Choose a new --output; results are immutable.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const trials = 15;
const temporary = path.join(root, '.tmp/batch-parsing');
await fs.mkdir(temporary, { recursive: true });
const sourceFile = path.join(root, 'src/core/analysis/callees.ts');
const source = (await fs.readFile(sourceFile, 'utf8')).replaceAll('\r\n', '\n');
function replaceOnce(text, before, after) {
    assert.equal(text.split(before).length, 2, `Instrumentation anchor changed: ${before}`);
    return text.replace(before, after);
}
let instrumented = replaceOnce(source, 'await readExportedDefinitions(dependency)',
    'await globalThis.__batchProbe.index(resolved, () => readExportedDefinitions(dependency))');
instrumented = replaceOnce(instrumented, 'fs.readFile(resolved, "utf8")',
    'globalThis.__batchProbe.read(resolved, () => fs.readFile(resolved, "utf8"))');
instrumented = replaceOnce(instrumented, '\n        ast = parse(code, PARSE_OPTIONS);',
    '\n        ast = globalThis.__batchProbe.parse(() => parse(code, PARSE_OPTIONS));');
const cores = {};
const bundleHashes = {};
for (const arm of ['plain', 'profiled']) {
    const outfile = path.join(temporary, `${arm}.cjs`);
    await build({ stdin: { contents: 'export { predictFiles } from "./src/core/prediction/predictFiles";',
        resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile,
        plugins: arm === 'profiled' ? [{ name: 'profile-dependency-parses', setup(builder) {
            builder.onLoad({ filter: /[\\/]analysis[\\/]callees\.ts$/ }, () => ({ contents: instrumented, loader: 'ts' }));
        } }] : [] });
    cores[arm] = require(outfile);
    bundleHashes[arm] = hash(await fs.readFile(outfile));
}
const manifests = [];
const groups = [];
for (const [corpus, name] of [['corpus', 'manifest.json'], ['corpus-ts', 'manifest-ts.json']]) {
    const bytes = await fs.readFile(path.join(here, name));
    const manifest = JSON.parse(bytes);
    manifests.push({ file: name, hash: hash(bytes) });
    for (const [label, group] of [['main', manifest], ['accuracy', manifest.accuracy]]) {
        if (!group) continue;
        groups.push({ name: `${corpus}/${label}`, files: [...group.bugs.map(item => item.file), ...group.controls]
            .map(file => path.join(here, corpus, file)) });
    }
}
const files = groups.flatMap(group => group.files);
assert.equal(new Set(files).size, files.length);
const storage = new AsyncLocalStorage();
let events = [];
let reads = [];
globalThis.__batchProbe = {
    read: async (file, operation) => {
        const start = performance.now();
        try { return await operation(); }
        finally { reads.push({ file: path.relative(root, file).replaceAll('\\', '/'), readMs: performance.now() - start }); }
    },
    index: async (file, operation) => {
        const event = { file: path.relative(root, file).replaceAll('\\', '/'), parseMs: 0 };
        events.push(event);
        const start = performance.now();
        try { return await storage.run(event, operation); }
        finally { event.indexMs = performance.now() - start; }
    },
    parse: operation => {
        const start = performance.now();
        try { return operation(); }
        finally { storage.getStore().parseMs += performance.now() - start; }
    }
};
async function run(arm, selected, concurrency) {
    events = [];
    reads = [];
    const prompts = [];
    const start = performance.now();
    const result = await cores[arm].predictFiles(selected, { concurrency,
        location: { file: 'local-response-stub' }, provider: { complete: async (_location, options) => {
            prompts.push(hash(options.prompt));
            return '{"pattern":"none","score":0,"reason":"local profiling stub"}';
        } } });
    const wallMs = performance.now() - start;
    assert.deepEqual(result.failures, []);
    assert.equal(prompts.length, selected.length);
    const seen = new Set();
    let repeatedParseMs = 0;
    let repeatedIndexMs = 0;
    for (const event of events) {
        if (seen.has(event.file)) {
            repeatedParseMs += event.parseMs;
            repeatedIndexMs += event.indexMs;
        }
        seen.add(event.file);
    }
    const readFiles = new Set();
    let repeatedReadMs = 0;
    for (const read of reads) {
        if (readFiles.has(read.file)) repeatedReadMs += read.readMs;
        readFiles.add(read.file);
    }
    return { wallMs, promptHashes: prompts.sort(), resultHash: hash(JSON.stringify(result)),
        dependencyIndexes: events.length, uniqueDependencies: seen.size,
        repeatedIndexes: events.length - seen.size,
        parseMs: events.reduce((sum, event) => sum + event.parseMs, 0), repeatedParseMs,
        indexMs: events.reduce((sum, event) => sum + event.indexMs, 0), repeatedIndexMs,
        readMs: reads.reduce((sum, event) => sum + event.readMs, 0), repeatedReadMs, events, reads };
}
const cold = {};
for (const arm of ['plain', 'profiled']) cold[arm] = await run(arm, files, 4);
assert.deepEqual(cold.plain.promptHashes, cold.profiled.promptHashes);
assert.equal(cold.plain.resultHash, cold.profiled.resultHash);
const experiments = [];
for (const workload of [...groups, { name: 'all-existing-targets', files }]) {
    for (const concurrency of [1, 4]) {
        // Warm both bundles before alternating order to reduce startup and order bias.
        for (const arm of ['plain', 'profiled']) await run(arm, workload.files, concurrency);
        const runs = [];
        for (let trial = 0; trial < trials; trial++) {
            const pair = {};
            for (const arm of trial % 2 ? ['profiled', 'plain'] : ['plain', 'profiled']) {
                pair[arm] = await run(arm, workload.files, concurrency);
            }
            assert.deepEqual(pair.plain.promptHashes, pair.profiled.promptHashes);
            assert.equal(pair.plain.resultHash, pair.profiled.resultHash);
            runs.push(pair);
        }
        const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const summary = Object.fromEntries(['plain', 'profiled'].map(arm => [arm,
            Object.fromEntries(['wallMs', 'dependencyIndexes', 'uniqueDependencies', 'repeatedIndexes', 'parseMs', 'repeatedParseMs',
                'indexMs', 'repeatedIndexMs', 'readMs', 'repeatedReadMs']
                .map(key => [key, median(runs.map(run => run[arm][key]))]))]));
        experiments.push({ workload: workload.name, files: workload.files.map(file => path.relative(root, file)),
            concurrency, summary, runs });
        console.log(JSON.stringify({ workload: workload.name, files: workload.files.length, concurrency, summary }));
    }
}
async function treeHashes(directory) {
    const entries = [];
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) entries.push(...await treeHashes(file));
        else entries.push({ file: path.relative(root, file).replaceAll('\\', '/'), hash: hash(await fs.readFile(file)) });
    }
    return entries;
}
const config = { trials, bundleHashes, manifests, runnerHash: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    sources: [...await treeHashes(path.join(here, 'corpus')), ...await treeHashes(path.join(here, 'corpus-ts'))],
    node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model,
    note: 'Local response stub, zero external provider calls. Parse time is synchronous dependency AST parsing only. Index time includes parsing; read/index durations include async waits and can overlap across workers, so do not add them or interpret them as wall-time savings. Stat and module resolution are not timed separately. Plain-arm counters are uninstrumented placeholders. Repeated time is measured work, not an observed cache speedup. No cache implemented. Cold arms share an OS process and filesystem cache.' };
await fs.writeFile(output, JSON.stringify({ config, configHash: hash(JSON.stringify(config)),
    timestamp: new Date().toISOString(), cold, experiments }, null, 2) + '\n', { flag: 'wx' });
console.log(`Saved ${output}`);
