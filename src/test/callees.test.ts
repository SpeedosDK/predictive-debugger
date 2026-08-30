import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { collectCalleeContext } from "../core/analysis/callees";

const roots: string[] = [];

after(async () => {
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

/** Write a small tree and return the absolute path of its entry file. */
async function tree(files: Record<string, string>, entry = "index.ts"): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pd-callees-"));
    roots.push(root);

    for (const [name, contents] of Object.entries(files)) {
        const full = path.join(root, name);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, contents, "utf8");
    }

    return path.join(root, entry);
}

async function collect(files: Record<string, string>, entry = "index.ts") {
    const file = await tree(files, entry);
    return collectCalleeContext(file, await fs.readFile(file, "utf8"));
}

describe("collectCalleeContext", () => {
    it("resolves the callee that caused the false positive this exists for", async () => {
        // The reported defect was that a date was normalised twice. The disproof
        // was that normalizeBillingDate is idempotent -- visible only in the
        // file one import away, which single-file scope never sent. See issue #4.
        const callees = await collect({
            "index.ts": [
                'import { normalizeBillingDate } from "./dates";',
                "export function bill(row) {",
                "    return normalizeBillingDate(row.due);",
                "}"
            ].join("\n"),
            "dates.ts": [
                "export function normalizeBillingDate(value) {",
                "    return value instanceof Date ? value : new Date(value);",
                "}"
            ].join("\n")
        });

        assert.equal(callees.length, 1);
        assert.equal(callees[0].name, "normalizeBillingDate");
        assert.equal(callees[0].from, "./dates.ts");
        assert.match(callees[0].source, /value instanceof Date/);
        assert.equal(callees[0].excerpted, undefined);
    });

    it("keeps the declaration keyword on an arrow-function export", async () => {
        const callees = await collect({
            "index.ts": 'import { guard } from "./guard";\nguard(1);\n',
            "guard.ts": "export const guard = (n) => (n > 0 ? n : 0);\n"
        });

        assert.equal(callees.length, 1);
        assert.match(callees[0].source, /^const guard = /);
    });

    it("follows a local export alias but not a re-export from another module", async () => {
        const callees = await collect({
            "index.ts": 'import { pick, passthrough } from "./barrel";\npick(1);\npassthrough(2);\n',
            "barrel.ts": [
                "function chosen(n) { return n; }",
                'export { chosen as pick };',
                'export { passthrough } from "./deep";'
            ].join("\n"),
            "deep.ts": "export function passthrough(n) { return n; }\n"
        });

        // One more hop is one more hop, and the budget is spent on the first.
        assert.deepEqual(
            callees.map((c) => c.name),
            ["pick"]
        );
        assert.match(callees[0].source, /function chosen/);
    });

    it("resolves a default import", async () => {
        const callees = await collect({
            "index.ts": 'import retry from "./retry";\nretry(() => 1);\n',
            "retry.ts": "export default function retry(fn) { return fn(); }\n"
        });

        assert.equal(callees.length, 1);
        assert.match(callees[0].source, /function retry\(fn\)/);
    });

    it("resolves a namespace import through the member that was called", async () => {
        const callees = await collect({
            "index.ts": 'import * as money from "./money";\nmoney.round(1.005);\n',
            "money.ts": [
                "export function round(n) { return Math.round(n * 100) / 100; }",
                "export function floor(n) { return Math.floor(n); }"
            ].join("\n")
        });

        assert.deepEqual(
            callees.map((c) => c.name),
            ["money.round"]
        );
        assert.match(callees[0].source, /Math.round/);
    });

    it("resolves an import written with the emitted .js extension", async () => {
        // Node16 module resolution has TypeScript sources import each other by
        // the extension of the emitted file. Without the swap, the lookup finds
        // nothing in exactly the codebases most likely to need it.
        const callees = await collect({
            "index.ts": 'import { clamp } from "./math.js";\nclamp(2);\n',
            "math.ts": "export function clamp(n) { return Math.min(1, n); }\n"
        });

        assert.equal(callees.length, 1);
        assert.equal(callees[0].from, "./math.ts");
    });

    it("resolves a directory import through its index file", async () => {
        const callees = await collect({
            "index.ts": 'import { helper } from "./util";\nhelper();\n',
            "util/index.ts": "export function helper() { return 1; }\n"
        });

        assert.equal(callees.length, 1);
        assert.equal(callees[0].from, "./util/index.ts");
    });

    it("ignores bare specifiers, so node_modules is never walked", async () => {
        const callees = await collect({
            "index.ts": 'import { readFile } from "fs/promises";\nreadFile("x");\n'
        });

        assert.deepEqual(callees, []);
    });

    it("ignores a name the dependency does not export", async () => {
        const callees = await collect({
            "index.ts": 'import { hidden } from "./private";\nhidden();\n',
            "private.ts": "function hidden() { return 1; }\nexport const shown = 2;\n"
        });

        assert.deepEqual(callees, []);
    });

    it("ignores a type-only import, which cannot be called at runtime", async () => {
        const callees = await collect({
            "index.ts": [
                'import type { Shape } from "./shape";',
                'import { area } from "./shape";',
                "area({} as Shape);"
            ].join("\n"),
            "shape.ts": "export interface Shape { w: number }\nexport function area(s) { return s.w; }\n"
        });

        assert.deepEqual(
            callees.map((c) => c.name),
            ["area"]
        );
    });

    it("ignores a method called on an imported value", async () => {
        // `client.get()` is a method on an object; the definition we would find
        // is the object, which is not what was called.
        const callees = await collect({
            "index.ts": 'import { client } from "./client";\nclient.get("/x");\n',
            "client.ts": "export const client = { get(u) { return u; } };\n"
        });

        assert.deepEqual(callees, []);
    });

    it("returns nothing rather than throwing when a dependency will not parse", async () => {
        const callees = await collect({
            "index.ts": 'import { broken } from "./broken";\nbroken();\n',
            "broken.ts": "export function broken( { { {\n"
        });

        assert.deepEqual(callees, []);
    });

    it("returns nothing rather than throwing when the import does not resolve", async () => {
        const callees = await collect({
            "index.ts": 'import { gone } from "./nowhere";\ngone();\n'
        });

        assert.deepEqual(callees, []);
    });

    it("ranks the most-called helper first, so a bound budget keeps the load-bearing one", async () => {
        const callees = await collect({
            "index.ts": [
                'import { once } from "./once";',
                'import { often } from "./often";',
                "once();",
                "often(); often(); often();"
            ].join("\n"),
            "once.ts": "export function once() { return 1; }\n",
            "often.ts": "export function often() { return 2; }\n"
        });

        assert.deepEqual(
            callees.map((c) => c.name),
            ["often", "once"]
        );
    });

    it("excerpts an oversized definition and says that it did", async () => {
        const huge = ["export function big(n) {", ...Array.from({ length: 400 }, (_, i) => `    const v${i} = ${i};`), "    return n;", "}"].join("\n");
        const callees = await collect({
            "index.ts": 'import { big } from "./big";\nbig(1);\n',
            "big.ts": `${huge}\n`
        });

        assert.equal(callees.length, 1);
        assert.equal(callees[0].excerpted, true);
        assert.ok(callees[0].source.length <= 3_100, `was ${callees[0].source.length} chars`);
        // The signature has to survive the cut, or the entry costs tokens and
        // says nothing.
        assert.match(callees[0].source, /^function big\(n\)/);
        assert.ok(callees[0].source.endsWith("/* … */"));
    });

    it("stops at the total budget rather than sending every import", async () => {
        const body = Array.from({ length: 120 }, (_, i) => `    const v${i} = ${i};`).join("\n");
        const files: Record<string, string> = {
            "index.ts": ""
        };
        const lines: string[] = [];
        for (let i = 0; i < 20; i++) {
            files[`dep${i}.ts`] = `export function fn${i}() {\n${body}\n}\n`;
            lines.push(`import { fn${i} } from "./dep${i}";`);
        }
        for (let i = 0; i < 20; i++) {
            lines.push(`fn${i}();`);
        }
        files["index.ts"] = `${lines.join("\n")}\n`;

        const callees = await collect(files);

        assert.ok(callees.length > 0 && callees.length <= 12, `got ${callees.length}`);
        const total = callees.reduce((sum, c) => sum + c.source.length, 0);
        assert.ok(total <= 16_000, `spent ${total} chars`);
    });
});
