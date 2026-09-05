import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectSourceContext } from "../core/analysis/sourceContext";

describe("bounded source context", () => {
    it("keeps small files intact", async () => {
        const result = await selectSourceContext("const a = 1;\n", 100);
        assert.equal(result.text, "1| const a = 1;\n2| ");
        assert.equal(result.truncated, undefined);
    });
    it("includes complete functions at the end without exceeding the budget", async () => {
        const code = Array.from({ length: 30 }, (_, i) =>
            `export function f${i}() {\n    return ${i};\n}`).join("\n");
        const result = await selectSourceContext(code, 400);
        assert.ok(result.text.length <= 400);
        assert.match(result.text, /88\| export function f29/);
        assert.match(result.text, /90\| }/);
        assert.match(result.truncated!, /omitted code was not reviewed/);
        assert.ok(!result.ranges.some(([start, end]) => start <= 45 && end >= 45));
    });
    it("keeps class state with selected methods", async () => {
        const code = `class Service {\n    count = 0;\n${Array.from({ length: 30 }, (_, i) =>
            `    f${i}() {\n        return this.count;\n    }`).join("\n")}\n}`;
        const result = await selectSourceContext(code, 450);
        assert.ok(result.text.length <= 450);
        assert.match(result.text, /count = 0/);
        assert.match(result.text, /f29\(\)/);
    });
    it("bounds unparsable and oversized single-line input", async () => {
        for (const code of ["function broken( {\n".repeat(200), "x".repeat(1_000)]) {
            const result = await selectSourceContext(code, 100);
            assert.ok(result.text.length <= 100);
            assert.ok(result.truncated);
        }
    });
});
