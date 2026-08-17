import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyMetrics } from "../core/analysis/ast";
import { analyzeSource, calculateRisk, explainRisk } from "../core/analysis/risk";

describe("calculateRisk", () => {
    it("scores an empty file near zero", () => {
        const metrics = emptyMetrics();
        // cyclomatic starts at 1, which contributes 0.02.
        assert.equal(calculateRisk(metrics), 0.02);
    });

    it("weights nested loops above branches", () => {
        const nested = { ...emptyMetrics(), nestedLoops: 1 };
        const branchy = { ...emptyMetrics(), branches: 1 };
        assert.ok(calculateRisk(nested) > calculateRisk(branchy));
    });

    it("never exceeds 1", () => {
        const metrics = {
            functions: 500,
            longFunctions: 100,
            branches: 100,
            asyncCalls: 100,
            nestedLoops: 100,
            mutations: 100,
            tryCatch: 100,
            cyclomatic: 500
        };
        assert.equal(calculateRisk(metrics), 1);
    });

    it("is monotonic — adding a signal never lowers the score", () => {
        const base = emptyMetrics();
        const baseScore = calculateRisk(base);
        for (const key of Object.keys(base) as Array<keyof typeof base>) {
            const bumped = { ...base, [key]: base[key] + 1 };
            assert.ok(
                calculateRisk(bumped) >= baseScore,
                `increasing ${key} lowered the score`
            );
        }
    });
});

describe("explainRisk", () => {
    it("omits signals that did not fire", () => {
        const signals = explainRisk({ ...emptyMetrics(), nestedLoops: 2 });
        assert.ok(signals.some((s) => s.includes("nested loop")));
        assert.ok(!signals.some((s) => s.includes("try/catch")));
    });

    it("orders signals by contribution, largest first", () => {
        // 1 nested loop = 0.20, 1 branch = 0.05 -> nested loop must come first.
        const signals = explainRisk({
            ...emptyMetrics(),
            nestedLoops: 1,
            branches: 1
        });
        assert.match(signals[0], /nested loop/);
    });

    it("returns only the cyclomatic baseline for an empty file", () => {
        assert.deepEqual(explainRisk(emptyMetrics()), ["cyclomatic complexity 1"]);
    });
});

describe("analyzeSource — unparseable input", () => {
    it("reports a parse error instead of throwing", async () => {
        const result = await analyzeSource("broken.js", "function broken( {");
        assert.equal(result.parseError !== undefined, true);
        assert.equal(result.riskScore, 0);
        assert.match(result.signals[0], /could not be parsed/);
    });

    it("leaves parseError unset for valid input", async () => {
        const result = await analyzeSource("ok.js", "const x = 1;");
        assert.equal(result.parseError, undefined);
    });
});
