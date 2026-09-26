import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveModule } from "../core/analysis/moduleResolution";

test("imports of non-source files do not resolve, so they never reach the model", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-"));
    try {
        await fs.writeFile(path.join(dir, "secrets.json"), "{}");
        await fs.writeFile(path.join(dir, ".env"), "KEY=1");
        await fs.writeFile(path.join(dir, "helper.ts"), "export const a = 1;");
        assert.equal(await resolveModule(dir, "./secrets.json"), undefined);
        assert.equal(await resolveModule(dir, "./.env"), undefined);
        assert.equal(await resolveModule(dir, "./helper"), path.join(dir, "helper.ts"));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
