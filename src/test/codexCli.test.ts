import assert from "node:assert/strict";
import { test } from "node:test";
import { execArgs } from "../providers/codexCli";

test("review calls run read-only with shell, browser and computer-use tools off", () => {
    const args = execArgs("out.txt", "gpt-x");
    assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
    for (const feature of ["shell_tool", "unified_exec", "browser_use", "computer_use", "apps", "plugins", "multi_agent"]) {
        assert.ok(args.includes(`features.${feature}=false`), feature);
    }
    // --disable fails on names a CLI version does not know; -c ignores them.
    assert.ok(!args.includes("--disable"));
    assert.deepEqual(args.slice(-2), ["--model", "gpt-x"]);
});
