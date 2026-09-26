import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkTypes } from "../core/analysis/checkTypes";

async function fixture(files: Record<string, string>, run: (root: string) => void): Promise<void> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "predictive-types-"));
    try {
        for (const [name, source] of Object.entries(files)) {
            await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
            await fs.writeFile(path.join(root, name), source);
        }
        run(root);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("compiler checks optional contracts and preserves guarded accesses", async () => {
    await fixture({
        "tsconfig.json": '{"compilerOptions":{"strict":true},"include":["*.ts"]}',
        "contract.ts": 'export interface Row { discount?: { amount: number } }',
        "bad.ts": 'import { Row } from "./contract"; export const discount = (r: Row) => r.discount.amount;',
        "good.ts": 'import { Row } from "./contract"; export const discount = (r: Row) => r.discount?.amount ?? 0;'
    }, root => {
        const result = checkTypes({ files: [path.join(root, "bad.ts"), path.join(root, "good.ts")] });
        assert.equal(result.status, "checked");
        if (result.status !== "checked") return;
        assert.equal(result.diagnostics.length, 1);
        assert.equal(result.diagnostics[0].code, 18048);
        assert.equal(result.diagnostics[0].line, 1);
        assert.deepEqual(result.contextIssues, []);
    });
});

test("config roots retain ambient declarations, inherited aliases and selected-file filtering", async () => {
    await fixture({
        "base.json": '{"compilerOptions":{"strict":true,"baseUrl":".","paths":{"@contract":["contract.ts"]}}}',
        "tsconfig.json": '{"extends":"./base.json","include":["*.ts"]}',
        "globals.d.ts": 'declare const featureFlag: boolean;',
        "contract.ts": 'export interface Value { name: string }',
        "unselected.ts": 'export const broken: string = 1;',
        "selected.ts": 'import { Value } from "@contract"; export function name(v: Value) { return featureFlag ? v.name : ""; }'
    }, root => {
        const result = checkTypes({ files: [path.join(root, "selected.ts")] });
        assert.equal(result.status, "checked");
        if (result.status !== "checked") return;
        assert.deepEqual(result.diagnostics, []);
        assert.deepEqual(result.contextIssues, []);
        assert.equal(result.mode, "project");
    });
});

test("inferred settings check JS, while configured JS opt-outs are explicit", async () => {
    await fixture({ "value.js": 'export const value = "7".toFixed(2);' }, root => {
        const result = checkTypes({ files: [path.join(root, "value.js")] });
        assert.equal(result.status, "checked");
        if (result.status !== "checked") return;
        assert.equal(result.mode, "inferred");
        assert.ok(result.diagnostics.some(d => d.code === 2551));
    });
    await fixture({
        "jsconfig.json": '{"compilerOptions":{"allowJs":true,"checkJs":false},"include":["*.js"]}',
        "value.js": 'export const value = "7".toFixed(2);',
        "checked.js": '// @ts-check\nexport const value = "7".toFixed(2);',
        "disabled.js": '// @ts-nocheck\nexport const value = "7".toFixed(2);'
    }, root => {
        const result = checkTypes({ files: ["value.js", "checked.js", "disabled.js"].map(f => path.join(root, f)) });
        assert.equal(result.status, "checked");
        if (result.status !== "checked") return;
        assert.equal(result.skipped.length, 2);
        assert.deepEqual(result.checked, [path.join(root, "checked.js")]);
        assert.equal(result.diagnostics.length, 1);
    });
});

test("missing dependencies are context issues and oversized inputs are unavailable", async () => {
    await fixture({ "value.ts": 'import { x } from "./missing"; export const value = x;' }, root => {
        const result = checkTypes({ files: [path.join(root, "value.ts")] });
        assert.equal(result.status, "checked");
        if (result.status !== "checked") return;
        assert.ok(result.contextIssues.some(d => d.code === 2307));
    });
    await fixture({ "huge.ts": " ".repeat(4 * 1024 * 1024 + 1) }, root => {
        const result = checkTypes({ files: [path.join(root, "huge.ts")] });
        assert.equal(result.status, "unavailable");
        if (result.status === "unavailable") assert.match(result.reason, /4 MB/);
    });
});

test("project references and excessive diagnostics are disclosed", async () => {
    await fixture({ "tsconfig.json": '{"files":["value.ts"],"references":[{"path":"./child"}]}', "value.ts": '' }, root => {
        const result = checkTypes({ files: [path.join(root, "value.ts")] });
        assert.equal(result.status, "unavailable");
        if (result.status === "unavailable") assert.match(result.reason, /references/);
    });
    await fixture({ "value.ts": Array.from({ length: 105 }, (_, i) => `export const x${i}: string = 1;`).join("\n") }, root => {
        const result = checkTypes({ files: [path.join(root, "value.ts")] });
        assert.equal(result.status, "checked");
        if (result.status !== "checked") return;
        assert.equal(result.diagnostics.length, 100);
        assert.equal(result.truncated, true);
    });
});

test("noCheck and unresolved imported return types cannot produce an unqualified clean check", async () => {
    await fixture({ "tsconfig.json": '{"compilerOptions":{"strict":true,"noCheck":true}}', "value.ts": 'export const a: string = 1;' }, root => {
        const result = checkTypes({ files: [path.join(root, "value.ts")] });
        assert.equal(result.status, "unavailable");
        if (result.status === "unavailable") assert.match(result.reason, /noCheck/);
    });
    await fixture({
        "tsconfig.json": '{"compilerOptions":{"strict":true}}',
        "value.ts": 'import { get } from "./dependency"; export const x = get().missingMethod();',
        "dependency.ts": 'import { Missing } from "./absent"; export function get(): Missing { return null; }'
    }, root => {
        const result = checkTypes({ files: [path.join(root, "value.ts")] });
        assert.equal(result.status, "checked");
        if (result.status !== "checked") return;
        assert.ok(result.contextIssues.some(d => d.code === 2307 && d.file?.endsWith("dependency.ts")));
    });
});
