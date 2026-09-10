import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import * as babel from "../core/analysis/ast";
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

    it("follows local export aliases and explicit re-exports", async () => {
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
            ["pick", "passthrough"]
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

    it("includes referenced type contracts alongside runtime calls", async () => {
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
            ["area", "Shape"]
        );
    });

    it("includes an imported object when its called method is declared", async () => {
        // `client.get()` is a method on an object; the definition we would find
        // is the object, which is not what was called.
        const callees = await collect({
            "index.ts": 'import { client } from "./client";\nclient.get("/x");\n',
            "client.ts": "export const client = { get(u) { return u; } };\n"
        });

        assert.equal(callees[0].name, "client.get");
        assert.match(callees[0].source, /get\(u\)/);
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

    it("resolves `export default foo` back to the declaration of foo", async () => {
        // This returned `const total = total` -- the identifier sliced as its
        // own definition, which is worse than sending nothing. Found by running
        // predict_failures on this project's own source.
        const callees = await collect({
            "index.ts": [
                'import total from "./total";',
                "export function bill(cart) {",
                "    return total(cart.items);",
                "}"
            ].join("\n"),
            "total.ts": [
                "function total(items) {",
                "    return items.reduce((sum, i) => sum + i.price, 0);",
                "}",
                "",
                "export default total;"
            ].join("\n")
        });

        assert.equal(callees.length, 1);
        assert.match(callees[0].source, /items\.reduce/);
        assert.doesNotMatch(callees[0].source, /^const total = total$/);
    });

    it("resolves `export default` of a const the same way", async () => {
        const callees = await collect({
            "index.ts": [
                'import total from "./total";',
                "export function bill(cart) {",
                "    return total(cart.items);",
                "}"
            ].join("\n"),
            "total.ts": [
                "const total = (items) => items.reduce((sum, i) => sum + i.price, 0);",
                "",
                "export default total;"
            ].join("\n")
        });

        assert.equal(callees.length, 1);
        assert.match(callees[0].source, /items\.reduce/);
    });

    it("sends nothing when the default export names something not declared here", async () => {
        // Better an absent callee than a misleading one: the name resolves to
        // no definition in this file, so there is nothing honest to show.
        const callees = await collect({
            "index.ts": [
                'import total from "./total";',
                "export function bill(cart) {",
                "    return total(cart.items);",
                "}"
            ].join("\n"),
            "total.ts": ['import { total } from "./elsewhere";', "", "export default total;"].join(
                "\n"
            )
        });

        assert.deepEqual(callees, []);
    });
});


describe("callee bindings and shared dependencies", () => {
    it("ignores shadowed named and namespace imports", async () => {
        const callees = await collect({
            "index.ts": 'import { guard } from "./helpers"; import * as ns from "./helpers"; function f(guard, ns) { guard(); ns.guard(); }',
            "helpers.ts": 'export function guard() { return 1; }'
        });
        assert.deepEqual(callees, []);
    });
    it("keeps real import calls outside a shadowing scope", async () => {
        const callees = await collect({
            "index.ts": 'import { guard } from "./helpers"; function f(guard) { guard(); } guard();',
            "helpers.ts": 'export function guard() { return 1; }'
        });
        assert.deepEqual(callees.map(c => c.name), ["guard"]);
    });
    it("resolves multiple exports and default aliases from one dependency", async () => {
        const callees = await collect({
            "index.ts": 'import first, { a, b as renamed } from "./helpers"; import second from "./helpers"; first(); second(); a(); renamed();',
            "helpers.ts": 'export default () => 3; export function a() { return 1; } const b = () => 2; export { b };'
        });
        assert.deepEqual(callees.map(c => c.name), ["first", "second", "a", "renamed"]);
        assert.match(callees[0].source, /^const first = /);
        assert.match(callees[1].source, /^const second = /);
        assert.match(callees[3].source, /const b = /);
    });
});


describe("dependency parse reuse", () => {
    it("parses shared dependencies once and refreshes on the next collection", async (t) => {
        const dependency = "export function a() {} export function b() {}";
        const code = 'import { a, b } from "./helpers"; a(); b();';
        const file = await tree({ "index.ts": code, "helpers.ts": dependency });
        const original = await babel.loadBabel();
        let parses = 0;
        t.mock.method(babel, "loadBabel", async () => ({
            ...original,
            parse: (source: string, options: Parameters<typeof original.parse>[1]) => {
                if (source === dependency) parses++;
                return original.parse(source, options);
            }
        }));
        assert.equal((await collectCalleeContext(file, code)).length, 2);
        assert.equal(parses, 1);
        assert.equal((await collectCalleeContext(file, code)).length, 2);
        assert.equal(parses, 2);
    });
});


describe("bounded dependency contracts", () => {
    it("resolves JSONC path mappings inherited from a local config", async () => {
        const callees = await collect({
            "tsconfig.json": '{"extends":"./base.json", "compilerOptions": {"strict":true}}',
            "base.json": '{/* local aliases */ "compilerOptions":{"baseUrl":".","paths":{"@lib/*":["lib/*"],},},}',
            "index.ts": 'import { guard } from "@lib/guard"; guard();',
            "lib/guard.ts": 'export function guard() { return 1; }'
        });
        assert.equal(callees[0].from, "./lib/guard.ts");
    });
    it("stops cyclic barrel resolution", async () => {
        const callees = await collect({
            "index.ts": 'import { guard } from "./a"; guard();',
            "a.ts": 'export { guard } from "./b";',
            "b.ts": 'export { guard } from "./a";'
        });
        assert.deepEqual(callees, []);
    });
    it("does not include unused imported types", async () => {
        const callees = await collect({
            "index.ts": 'import type { Shape } from "./shape"; export const n = 1;',
            "shape.ts": 'export interface Shape { optional?: number }'
        });
        assert.deepEqual(callees, []);
    });
    it("resolves optional calls with their original object state", async () => {
        const callees = await collect({
            "index.ts": 'import { client } from "./client"; client?.get?.();',
            "client.ts": 'export const client = { value: 3, get() { return this.value; } };'
        });
        assert.equal(callees[0].name, "client.get");
        assert.match(callees[0].source, /value: 3/);
    });
});


describe("type contract scope and cost", () => {
    it("does not mistake generic or local types for imported contracts", async () => {
        const callees = await collect({
            "index.ts": 'import type { Row } from "./rows"; function f<Row>(row: Row) {} function g() { type Row = string; let row: Row; }',
            "rows.ts": 'export interface Row { discount?: number }'
        });
        assert.deepEqual(callees, []);
    });
    it("limits supporting context for small files", async () => {
        const callees = await collect({
            "index.ts": 'import { f } from "./helpers"; f();',
            "helpers.ts": `export function f() {\n${"    console.log(1);\n".repeat(300)}}`
        });
        assert.ok(callees.length > 0);
        assert.ok(callees.reduce((sum, c) => sum + c.source.length, 0) <= 1000);
    });
});

describe("oversized imported members", () => {
    const noisy = `noisy() {\n${"console.log('unrelated');\n".repeat(180)}}`;

    it("keeps a late called method, its state and transitive helpers within the small-file budget", async () => {
        const [context] = await collect({
            "index.ts": 'import { client } from "./client"; client.get();',
            "client.ts": `export const client = { ${noisy}, value: 42,
                normalize() { return this.value; }, get() { return this.normalize(); } };`
        });
        assert.match(context.source, /get\(\) \{ return this.normalize\(\); \}/);
        assert.match(context.source, /normalize\(\) \{ return this.value; \}/);
        assert.match(context.source, /value: 42/);
        assert.doesNotMatch(context.source, /unrelated/);
        assert.match(context.source, /omitted members\/state/);
        assert.equal(context.excerpted, true);
        assert.ok(context.source.length <= 1000);
        const { parse } = await babel.loadBabel();
        assert.doesNotThrow(() => parse(context.source, babel.PARSE_OPTIONS));
    });

    it("preserves small objects byte for byte", async () => {
        const declaration = 'const client = { value: 3, get() { return this.value; }, reset() { this.value = 0; } };';
        const [context] = await collect({
            "index.ts": 'import { client } from "./client"; client.get();',
            "client.ts": `export ${declaration}`
        });
        assert.equal(context.source, declaration.slice(0, -1));
        assert.equal(context.excerpted, undefined);
    });

    it("retains getter/setter pairs, arrow properties and state writers when they fit", async () => {
        const [context] = await collect({
            "index.ts": 'import { client } from "./client"; client.get();',
            "client.ts": `export const client = { ${noisy}, _value: 3,
                get value() { return this._value; }, set value(n) { this._value = n; },
                reset() { this._value = 0; }, get: () => 42 };`
        });
        assert.match(context.source, /get: \(\) => 42/);
        assert.match(context.source, /set value\(n\)/);
        assert.match(context.source, /get value\(\)/);
        assert.match(context.source, /reset\(\)/);
    });

    it("keeps class static state and private helpers in original order", async () => {
        const [context] = await collect({
            "index.ts": 'import { Client } from "./client"; Client.get();',
            "client.ts": `export class Client { static ${noisy}
                static value = 3; static { this.value = 4; }
                static #normalize() { return this.value; }
                static get() { return this.#normalize(); } }`
        });
        assert.match(context.source, /static get\(\)/);
        assert.match(context.source, /static #normalize\(\)/);
        assert.ok(context.source.indexOf('static value = 3') < context.source.indexOf('this.value = 4'));
        assert.ok(context.source.length <= 1000);
        const { parse } = await babel.loadBabel();
        assert.doesNotThrow(() => parse(context.source, babel.PARSE_OPTIONS));
    });

    it("applies selection through aliases and explicit barrel re-exports", async () => {
        const [context] = await collect({
            "index.ts": 'import client from "./barrel"; client.get();',
            "barrel.ts": 'export { default } from "./client";',
            "client.ts": `const client = { ${noisy}, get() { return 42; } }; export default client;`
        });
        assert.match(context.source, /get\(\) \{ return 42; \}/);
        assert.equal(context.from, './client.ts');
        assert.equal(context.excerpted, true);
    });

    it("marks missing state when a referenced field cannot fit", async () => {
        const [context] = await collect({
            "index.ts": 'import { client } from "./client"; client.get();',
            "client.ts": `export const client = { data: '${'x'.repeat(4000)}', get() { return this.data; } };`
        });
        assert.match(context.source, /get\(\) \{ return this.data; \}/);
        assert.doesNotMatch(context.source, /data: '/);
        assert.match(context.source, /omitted members\/state/);
        assert.equal(context.excerpted, true);
        assert.ok(context.source.length <= 1000);
    });

    it("starts an oversized method excerpt at the called method", async () => {
        const [context] = await collect({
            "index.ts": 'import { client } from "./client"; client.get();',
            "client.ts": `export const client = { ${noisy}, get() {\n${'console.log("called");\n'.repeat(180)}} };`
        });
        assert.match(context.source, /get\(\)/);
        assert.match(context.source, /called/);
        assert.doesNotMatch(context.source, /unrelated/);
        assert.equal(context.excerpted, true);
        assert.ok(context.source.length <= 1000);
    });

    it("does not prune spreads, computed keys or inherited classes", async () => {
        for (const source of [
            `export const client = { ${noisy}, get() { return 1; }, ...overrides };`,
            `export const client = { ${noisy}, get() { return 1; }, [key]() { return 2; } };`,
            `export const client = { ${noisy}, get() { return 1; }, get() { return 2; } };`,
            `export class client extends Parent { static ${noisy} static get() { return super.get(); } }`
        ]) {
            const [context] = await collect({
                "index.ts": 'import { client } from "./client"; client.get();',
                "client.ts": source
            });
            assert.match(context.source, /unrelated/);
            assert.equal(context.excerpted, true);
        }
    });

    it("does not loop on mutually recursive helpers or exceed the shared budget", async () => {
        const contexts = await collect({
            "index.ts": 'import { client } from "./client"; client.get(); client.other();',
            "client.ts": `export const client = { ${noisy}, a() { return this.b(); },
                b() { return this.a(); }, get() { return this.a(); }, other() { return 1; } };`
        });
        assert.equal(contexts.length, 2);
        assert.ok(contexts.reduce((sum, context) => sum + context.source.length, 0) <= 1000);
        assert.match(contexts[0].source, /a\(\) \{ return this.b\(\); \}/);
        assert.match(contexts[0].source, /b\(\) \{ return this.a\(\); \}/);
    });
});

describe("bounded export resolution", () => {
    it("follows wildcard barrels for named functions and referenced types", async () => {
        const contexts = await collect({
            "index.ts": 'import { guard, type Row } from "./barrel"; guard(); let row: Row;',
            "barrel.ts": 'export * from "./helpers"; export * from "./types";',
            "helpers.ts": 'export function guard() { return 1; }',
            "types.ts": 'export interface Row { value?: number }'
        });
        assert.deepEqual(contexts.map(context => context.name), ['guard', 'Row']);
        assert.equal(contexts[0].from, './helpers.ts');
        assert.match(contexts[1].source, /value\?: number/);
    });

    it("prefers explicit exports over conflicting stars", async () => {
        const [context] = await collect({
            "index.ts": 'import { guard } from "./barrel"; guard();',
            "barrel.ts": 'export * from "./a"; export { guard } from "./b";',
            "a.ts": 'export function guard() { return 1; }',
            "b.ts": 'export function guard() { return 2; }'
        });
        assert.match(context.source, /return 2/);
    });

    it("does not choose between conflicting star bindings, even with identical source", async () => {
        for (const second of ['export function guard() { return 1; }', 'export function guard() { return 2; }']) {
            assert.deepEqual(await collect({
                "index.ts": 'import { guard } from "./barrel"; guard();',
                "barrel.ts": 'export * from "./a"; export * from "./b";',
                "a.ts": 'export function guard() { return 1; }',
                "b.ts": second
            }), []);
        }
    });

    it("deduplicates diamond paths to the same binding", async () => {
        const [context] = await collect({
            "index.ts": 'import { guard } from "./barrel"; guard();',
            "barrel.ts": 'export * from "./a"; export * from "./b";',
            "a.ts": 'export { helper as guard } from "./helpers";',
            "b.ts": 'import { helper } from "./helpers"; export { helper as guard };',
            "helpers.ts": 'export function helper() { return 42; }'
        });
        assert.equal(context.from, './helpers.ts');
        assert.match(context.source, /return 42/);
    });

    it("distinguishes different bindings in the same terminal module", async () => {
        assert.deepEqual(await collect({
            "index.ts": 'import { guard } from "./barrel"; guard();',
            "barrel.ts": 'export * from "./a"; export * from "./b";',
            "a.ts": 'export { first as guard } from "./helpers";',
            "b.ts": 'export { second as guard } from "./helpers";',
            "helpers.ts": 'export function first() {} export function second() {}'
        }), []);
    });

    it("keeps ambiguity even if only one candidate has the requested object member", async () => {
        assert.deepEqual(await collect({
            "index.ts": 'import { client } from "./barrel"; client.get();',
            "barrel.ts": 'export * from "./a"; export * from "./b";',
            "a.ts": 'export const client = { get() { return 42; } };',
            "b.ts": 'export const client = { other() {} };'
        }), []);
    });

    it("treats unreadable, external and malformed star branches as unknown", async () => {
        for (const branch of ['./missing', 'external-package', './broken', './commonjs']) {
            assert.deepEqual(await collect({
                "index.ts": 'import { guard } from "./barrel"; guard();',
                "barrel.ts": `export * from "./helpers"; export * from "${branch}";`,
                "helpers.ts": 'export function guard() {}',
                "broken.ts": 'export function (',
                "commonjs.js": 'exports.guard = function () {};'
            }), []);
        }
    });

    it("does not leak default exports or their local declaration names through stars", async () => {
        for (const imported of ['guard', 'default as guard']) {
            assert.deepEqual(await collect({
                "index.ts": `import { ${imported} } from "./barrel"; guard();`,
                "barrel.ts": 'export * from "./helpers";',
                "helpers.ts": 'export default function guard() { return 42; }'
            }), []);
        }
    });

    it("finds a definition through a cycle but stops a cycle with no definition", async () => {
        const files = {
            "index.ts": 'import { guard } from "./a"; guard();',
            "a.ts": 'export * from "./b";',
            "b.ts": 'export * from "./a"; export * from "./helpers";',
            "helpers.ts": 'export function guard() { return 42; }'
        };
        assert.equal((await collect(files))[0].from, './helpers.ts');
        assert.deepEqual(await collect({ ...files, 'helpers.ts': 'export const other = 1;' }), []);
    });

    it("does not guess when another star branch exceeds the four-file depth limit", async () => {
        assert.deepEqual(await collect({
            "index.ts": 'import { guard } from "./barrel"; guard();',
            "barrel.ts": 'export * from "./helpers"; export * from "./a";',
            "helpers.ts": 'export function guard() {}',
            "a.ts": 'export * from "./b";',
            "b.ts": 'export * from "./c";',
            "c.ts": 'export * from "./d";',
            "d.ts": 'export const other = 1;'
        }), []);
    });

    it("honors explicit bindings that cannot be excerpted instead of falling through to stars", async () => {
        for (const explicit of ['export const { guard } = factory();', 'export * as guard from "./helpers";']) {
            assert.deepEqual(await collect({
                "index.ts": 'import { guard } from "./barrel"; guard();',
                "barrel.ts": `${explicit} export * from "./helpers";`,
                "helpers.ts": 'export function guard() { return 42; }'
            }), []);
        }
    });

    it("follows imported named and default bindings re-exported under aliases", async () => {
        for (const declaration of [
            'import { helper as local } from "./helpers"; export { local as guard };',
            'import local from "./helpers"; export { local as guard };',
            'import { helper as local } from "./helpers"; export default local;'
        ]) {
            const specifier = declaration.includes('export default') ? 'guard' : '{ guard }';
            const [context] = await collect({
                "index.ts": `import ${specifier} from "./barrel"; guard();`,
                "barrel.ts": declaration,
                "helpers.ts": 'export function helper() { return 42; } export default helper;'
            });
            assert.equal(context.from, './helpers.ts');
            assert.match(context.source, /return 42/);
        }
    });

    it("preserves distinct default value snapshots when checking star ambiguity", async () => {
        assert.deepEqual(await collect({
            "index.ts": 'import { guard } from "./barrel"; guard();',
            "barrel.ts": 'export * from "./a"; export * from "./b";',
            "a.ts": 'export { default as guard } from "./snapshot";',
            "b.ts": 'export { helper as guard } from "./helpers";',
            "snapshot.ts": 'import { helper } from "./helpers"; export default helper;',
            "helpers.ts": 'export function helper() {}'
        }), []);
    });

    it("preserves member selection through imported binding re-exports", async () => {
        const [context] = await collect({
            "index.ts": 'import { client } from "./barrel"; client.get();',
            "barrel.ts": 'import { client } from "./helpers"; export { client };',
            "helpers.ts": `export const client = { noisy() { ${'console.log(1);'.repeat(300)} }, get() { return 42; } };`
        });
        assert.match(context.source, /get\(\) \{ return 42; \}/);
        assert.equal(context.excerpted, true);
        assert.ok(context.source.length <= 1000);
    });

    it("collects imported constructors and respects shadowing", async () => {
        const contexts = await collect({
            "index.ts": 'import { Client } from "./helpers"; import * as ns from "./helpers"; new Client(); new ns.Client(); function f(Client) { new Client(); }',
            "helpers.ts": 'export class Client { constructor() { this.ready = true; } }'
        });
        assert.deepEqual(contexts.map(context => context.name), ['Client', 'ns.Client']);
        assert.match(contexts[0].source, /constructor\(\)/);
        assert.deepEqual(await collect({
            "index.ts": 'import { Client } from "./helpers"; function f(Client) { new Client(); }',
            "helpers.ts": 'export class Client {}'
        }), []);
    });

    it("bounds star expansion at the shared dependency parse limit", async () => {
        const files: Record<string, string> = {
            "index.ts": 'import { guard } from "./barrel"; guard();',
            "barrel.ts": Array.from({ length: 25 }, (_, i) => `export * from "./helper${i}";`).join('\n')
        };
        for (let i = 0; i < 25; i++) files[`helper${i}.ts`] = i === 0
            ? 'export function guard() {}' : `export const other${i} = 1;`;
        assert.deepEqual(await collect(files), []);
    });

    it("bounds repeated diamond traversal even when the files are already cached", async () => {
        for (const width of [6, 10]) {
            const files: Record<string, string> = {
                "index.ts": 'import { guard } from "./barrel"; guard();',
                "barrel.ts": Array.from({ length: width }, (_, i) => `export * from "./a${i}";`).join('\n'),
                "helpers.ts": 'export function guard() { return 42; }'
            };
            for (let i = 0; i < width; i++) {
                files[`a${i}.ts`] = Array.from({ length: width }, (_, j) => `export * from "./b${j}";`).join('\n');
                files[`b${i}.ts`] = 'export * from "./helpers";';
            }
            const contexts = await collect(files);
            assert.equal(contexts.length, width === 6 ? 1 : 0);
        }
    });

    it("follows an imported default constructor through a renamed re-export", async () => {
        const [context] = await collect({
            "index.ts": 'import { Client } from "./barrel"; new Client();',
            "barrel.ts": 'import Implementation from "./client"; export { Implementation as Client };',
            "client.ts": 'export default class Client { constructor() { this.ready = true; } }'
        });
        assert.match(context.source, /constructor\(\)/);
        assert.equal(context.from, './client.ts');
    });
});
