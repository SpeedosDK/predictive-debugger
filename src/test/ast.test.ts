import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectMetrics } from "../core/analysis/ast";

describe("collectMetrics", () => {
    it("counts functions of every shape", async () => {
        const metrics = await collectMetrics(`
            function a() {}
            const b = function () {};
            const c = () => {};
        `);
        assert.equal(metrics.functions, 3);
    });

    it("counts await and timers as async boundaries", async () => {
        const metrics = await collectMetrics(`
            async function f() {
                await g();
                setTimeout(() => {}, 10);
            }
        `);
        assert.equal(metrics.asyncCalls, 2);
    });

    it("detects nested loops but not sibling loops", async () => {
        const nested = await collectMetrics(
            "for (let i=0;i<2;i++) { for (let j=0;j<2;j++) {} }"
        );
        const siblings = await collectMetrics(
            "for (let i=0;i<2;i++) {} for (let j=0;j<2;j++) {}"
        );
        assert.equal(nested.nestedLoops, 1);
        assert.equal(siblings.nestedLoops, 0);
    });

    it("parses TypeScript and JSX", async () => {
        const metrics = await collectMetrics(
            "const f = (x: number): JSX.Element => <div>{x}</div>;"
        );
        assert.equal(metrics.functions, 1);
    });

    it("throws on input Babel cannot parse", async () => {
        // errorRecovery repairs some damage but not unbalanced braces. This is
        // the raw primitive, so it propagates — analyzeSource is the layer that
        // turns a parse failure into a reportable result. See risk.test.ts.
        await assert.rejects(collectMetrics("function broken( {"));
    });

    it("flags functions longer than 20 statements", async () => {
        const body = Array.from({ length: 25 }, (_, i) => `let v${i} = ${i};`).join("\n");
        const metrics = await collectMetrics(`function big() {\n${body}\n}`);
        assert.equal(metrics.longFunctions, 1);
    });
});
