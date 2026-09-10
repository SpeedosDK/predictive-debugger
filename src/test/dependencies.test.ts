import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { mapDependencies } from "../core/analysis/dependencies";

const roots: string[] = [];
after(async () => { await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true }))); });

async function tree(files: Record<string, string>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pd-map-"));
    roots.push(root);
    for (const [name, source] of Object.entries(files)) {
        const file = path.join(root, name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, source);
    }
    return root;
}

test("maps reverse imports and connected tests with evidence paths through barrels", async () => {
    const directory = await tree({
        'leaf.ts': 'export const value = 1;',
        'barrel.ts': 'export * from "./leaf";',
        'consumer.ts': 'import { value } from "./barrel"; export const result = value;',
        'consumer.test.ts': 'import { result } from "./consumer";',
        'unrelated.test.ts': 'export const untouched = true;'
    });
    const result = await mapDependencies({ directory, file: 'leaf.ts', depth: 3 });
    assert.deepEqual(result.dependents.map(n => n.file), ['barrel.ts', 'consumer.ts', 'consumer.test.ts']);
    const connectedTest = result.dependents[2];
    assert.equal(connectedTest.test, true);
    assert.deepEqual(connectedTest.via.map(edge => [edge.from, edge.to, edge.line]), [
        ['consumer.test.ts', 'consumer.ts', 1], ['consumer.ts', 'barrel.ts', 1], ['barrel.ts', 'leaf.ts', 1]
    ]);
    assert.equal(result.coverage.indexedFiles, 5);
    assert.equal(result.coverage.scanLimited, false);
    assert.equal(result.truncated, false);
});

test("bounds hops and terminates cycles without returning the focus itself", async () => {
    const directory = await tree({
        'a.ts': 'import "./b";', 'b.ts': 'import "./a"; import "./c";', 'c.ts': 'export const c = 1;'
    });
    const shallow = await mapDependencies({ directory, file: 'a.ts' });
    assert.deepEqual(shallow.dependencies.map(n => n.file), ['b.ts']);
    const deep = await mapDependencies({ directory, file: 'a.ts', depth: 3 });
    assert.deepEqual(deep.dependencies.map(n => n.file), ['b.ts', 'c.ts']);
    assert.ok(deep.dependencies.every(n => n.file !== 'a.ts'));
});

test("discloses incomplete coverage when directory discovery reaches its depth limit", async () => {
    const belowLimit = `${Array(65).fill('d').join('/')}/hidden.ts`;
    const directory = await tree({
        'entry.ts': 'export const entry = 1;',
        [belowLimit]: 'export const hidden = 1;'
    });
    const result = await mapDependencies({ directory, file: 'entry.ts' });
    assert.equal(result.coverage.scanLimited, true);
    assert.equal(result.coverage.discoveredFiles, 1);
    assert.equal(result.coverage.issues, 1);
    assert.equal(result.issues[0].reason, 'directory depth limit');
});

test("resolves path aliases, emitted extensions and directory indexes through the shared resolver", async () => {
    const directory = await tree({
        'tsconfig.json': '{"compilerOptions":{"paths":{"@lib/*":["./lib/*"]}}}',
        'entry.ts': 'import "@lib/helper.js"; import "./lib/folder";',
        'lib/helper.ts': 'export const helper = 1;', 'lib/folder/index.ts': 'export const value = 1;'
    });
    const result = await mapDependencies({ directory, file: 'entry.ts' });
    assert.deepEqual(result.dependencies.map(n => n.file), ['lib/folder/index.ts', 'lib/helper.ts']);
});

test("uses the importing directory's aliases in nested projects", async () => {
    const directory = await tree({
        'tsconfig.json': '{"compilerOptions":{"paths":{"@value":["./root-value"]}}}',
        'root-value.ts': 'export const n = 1;',
        'nested/tsconfig.json': '{"compilerOptions":{"paths":{"@value":["./local-value"]}}}',
        'nested/local-value.ts': 'export const n = 2;',
        'nested/entry.ts': 'import { n } from "@value";'
    });
    const result = await mapDependencies({ directory, file: 'nested/entry.ts' });
    assert.equal(result.dependencies[0].file, 'nested/local-value.ts');
});

test("distinguishes type imports and literal dynamic imports, and reports unsupported edges", async () => {
    const directory = await tree({
        'entry.ts': 'import type { Row } from "./types";\nimport("./lazy");\nimport(name);\nrequire("./legacy");\nimport "external";\nfunction f(require) { require("local"); }',
        'types.ts': 'export interface Row {}', 'lazy.ts': 'export const n = 1;'
    });
    const result = await mapDependencies({ directory, file: 'entry.ts' });
    assert.equal(result.dependencies.find(n => n.file === 'types.ts')!.via[0].typeOnly, true);
    assert.equal(result.dependencies.find(n => n.file === 'lazy.ts')!.via[0].kind, 'dynamic-import');
    assert.equal(result.coverage.focusUnresolved, 3);
    assert.deepEqual(result.unresolved.map(edge => edge.line), [3, 4, 5]);
});

test("excludes generated and vendor sources, but indexes tests", async () => {
    const directory = await tree({
        'entry.ts': 'export const n = 1;', 'entry.test.ts': 'import "./entry";',
        'dist/generated.ts': 'import "../entry";', 'node_modules/pkg/index.ts': 'import "../../entry";',
        '.hidden/file.ts': 'import "../entry";'
    });
    const result = await mapDependencies({ directory, file: 'entry.ts' });
    assert.deepEqual(result.dependents.map(n => n.file), ['entry.test.ts']);
    assert.equal(result.coverage.indexedFiles, 2);
});

test("reports bounded discovery and rejects a focus outside the scanned set", async () => {
    const directory = await tree({ 'a.ts': 'export const n = 1;', 'b.ts': 'import "./a";' });
    const result = await mapDependencies({ directory, file: 'a.ts', maxFiles: 1 });
    assert.equal(result.coverage.discoveredFiles, 1);
    assert.equal(result.coverage.scanLimited, true);
    await assert.rejects(mapDependencies({ directory, file: 'b.ts', maxFiles: 1 }), /not discovered/);
});

test("discloses parse and byte-limit failures while retaining known incoming imports", async () => {
    const directory = await tree({
        'broken.ts': 'export function (', 'consumer.ts': 'import "./broken";',
        'large.ts': ' '.repeat(4 * 1024 * 1024 + 1)
    });
    const result = await mapDependencies({ directory, file: 'broken.ts' });
    assert.equal(result.dependents[0].file, 'consumer.ts');
    assert.equal(result.coverage.issues, 2);
    assert.equal(result.coverage.indexedFiles, 1);
});

test("refreshes file relationships on the next request", async () => {
    const directory = await tree({ 'entry.ts': 'export const n = 1;', 'consumer.ts': 'import "./entry";' });
    assert.equal((await mapDependencies({ directory, file: 'entry.ts' })).dependents.length, 1);
    await fs.writeFile(path.join(directory, 'consumer.ts'), 'export const x = 1;');
    assert.equal((await mapDependencies({ directory, file: 'entry.ts' })).dependents.length, 0);
});

test("bounds the returned neighborhood without claiming there were no other neighbors", async () => {
    const directory = await tree({
        'entry.ts': 'import "./a"; import "./b";', 'a.ts': 'export const n = 1;', 'b.ts': 'export const n = 2;'
    });
    const result = await mapDependencies({ directory, file: 'entry.ts', limit: 1 });
    assert.equal(result.returned, 1);
    assert.equal(result.totalNeighbors, 2);
    assert.equal(result.truncated, true);
});

test("rejects out-of-root focuses and does not map imports outside the root", async () => {
    const parent = await tree({ 'outside.ts': 'export const n = 1;', 'src/entry.ts': 'import "../outside";' });
    const directory = path.join(parent, 'src');
    await assert.rejects(mapDependencies({ directory, file: '../outside.ts' }), /inside directory/);
    const result = await mapDependencies({ directory, file: 'entry.ts' });
    assert.equal(result.dependencies.length, 0);
    assert.equal(result.coverage.focusUnresolved, 1);
});

test("rejects invalid options at the core interface", async () => {
    const directory = await tree({ 'entry.ts': 'export const n = 1;' });
    for (const options of [{ depth: 0 }, { limit: 201 }, { maxFiles: 2001 }, { depth: 1.5 }]) {
        await assert.rejects(mapDependencies({ directory, file: 'entry.ts', ...options }), /Expected an integer/);
    }
});

test("maps type import expressions and discloses CommonJS import assignments", async () => {
    const directory = await tree({
        'entry.ts': 'type Row = import("./types").Row;\nimport legacy = require("./legacy");',
        'types.ts': 'export interface Row {}'
    });
    const result = await mapDependencies({ directory, file: 'entry.ts' });
    assert.equal(result.dependencies[0].via[0].typeOnly, true);
    assert.equal(result.unresolved[0].line, 2);
});

test("does not traverse junctions or map outside sources through them", async (t) => {
    const outside = await tree({ 'outside.ts': 'export const value = 1;' });
    const directory = await tree({ 'entry.ts': 'import "./linked/outside";' });
    try { await fs.symlink(outside, path.join(directory, 'linked'), 'junction'); }
    catch (error: any) {
        if (error.code === 'EPERM') { t.skip('junction creation unavailable'); return; }
        throw error;
    }
    const result = await mapDependencies({ directory, file: 'entry.ts' });
    assert.equal(result.coverage.discoveredFiles, 1);
    assert.equal(result.dependencies.length, 0);
    assert.equal(result.coverage.focusUnresolved, 1);
    await assert.rejects(mapDependencies({ directory, file: 'linked/outside.ts' }), /inside directory/);
});
