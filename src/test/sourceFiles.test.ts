import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { collectSourceFiles, isSourceFile } from "../core/sourceFiles";

describe("isSourceFile", () => {
    it("accepts the JavaScript and TypeScript extensions", () => {
        for (const name of ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx", "a.mts", "a.cts"]) {
            assert.ok(isSourceFile(name), `${name} should be a source file`);
        }
    });

    it("rejects everything else", () => {
        for (const name of ["a.json", "a.md", "a.py", "a.txt", "a"]) {
            assert.ok(!isSourceFile(name), `${name} should not be a source file`);
        }
    });

    it("is case-insensitive", () => {
        assert.ok(isSourceFile("Component.TSX"));
    });
});

describe("collectSourceFiles", () => {
    let root: string;

    before(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "pd-sourcefiles-"));
        await fs.mkdir(path.join(root, "src"), { recursive: true });
        await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
        await fs.mkdir(path.join(root, "out"), { recursive: true });
        await fs.mkdir(path.join(root, ".hidden"), { recursive: true });

        await fs.writeFile(path.join(root, "src", "index.ts"), "");
        await fs.writeFile(path.join(root, "src", "helper.js"), "");
        await fs.writeFile(path.join(root, "README.md"), "");
        await fs.writeFile(path.join(root, "node_modules", "pkg", "dep.js"), "");
        await fs.writeFile(path.join(root, "out", "built.js"), "");
        await fs.writeFile(path.join(root, ".hidden", "secret.ts"), "");
    });

    after(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("finds source files recursively", async () => {
        const files = (await collectSourceFiles(root)).map((f) => path.basename(f)).sort();
        assert.deepEqual(files, ["helper.js", "index.ts"]);
    });

    it("skips node_modules, build output, and dot directories", async () => {
        const files = await collectSourceFiles(root);
        assert.ok(!files.some((f) => f.includes("node_modules")));
        assert.ok(!files.some((f) => f.includes(`${path.sep}out${path.sep}`)));
        assert.ok(!files.some((f) => f.includes(".hidden")));
    });

    it("returns an empty list for a directory that does not exist", async () => {
        assert.deepEqual(await collectSourceFiles(path.join(root, "nope")), []);
    });
});
