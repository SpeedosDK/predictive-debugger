import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { emptyMetrics } from "../core/analysis/ast";
import {
    analyzeFile,
    analyzeSource,
    calculateRisk,
    calculateRiskDensity,
    explainRisk
} from "../core/analysis/risk";

describe("calculateRisk", () => {
    it("scores an empty file near zero", () => {
        // cyclomatic starts at 1, contributing a raw 0.02 before saturation.
        assert.ok(calculateRisk(emptyMetrics()) < 0.01);
    });

    it("weights nested loops above branches", () => {
        const nested = { ...emptyMetrics(), nestedLoops: 1 };
        const branchy = { ...emptyMetrics(), branches: 1 };
        assert.ok(calculateRisk(nested) > calculateRisk(branchy));
    });

    it("approaches but never reaches 1", () => {
        const extreme = {
            functions: 500,
            longFunctions: 100,
            branches: 100,
            asyncCalls: 100,
            nestedLoops: 100,
            mutations: 100,
            tryCatch: 100,
            cyclomatic: 500,
            lines: 800
        };
        const score = calculateRisk(extreme);
        assert.ok(score < 1, "score must stay below 1");
        assert.ok(score > 0.9, "an extreme file should score high");
    });

    it("keeps ranking heavy files apart instead of saturating at 1", () => {
        // The previous implementation clamped at 1, which made every
        // non-trivial real file score identically and broke scan_project.
        const heavy = { ...emptyMetrics(), branches: 40, mutations: 20, cyclomatic: 40 };
        const heavier = { ...emptyMetrics(), branches: 80, mutations: 40, cyclomatic: 80 };
        assert.ok(calculateRisk(heavy) < calculateRisk(heavier));
        assert.ok(calculateRisk(heavy) < 1 && calculateRisk(heavier) < 1);
    });

    it("puts an ordinary file in the middle of the range, not at the top", () => {
        const ordinary = { ...emptyMetrics(), branches: 12, asyncCalls: 4, mutations: 5, cyclomatic: 13 };
        const score = calculateRisk(ordinary);
        assert.ok(score > 0.2 && score < 0.85, `ordinary file scored ${score}`);
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

describe("calculateRiskDensity", () => {
    it("does not reward a file for being long", () => {
        // Same code, twice over: the total risk doubles, the density does not.
        const single = { ...emptyMetrics(), asyncCalls: 4, nestedLoops: 1, lines: 50 };
        const doubled = { ...emptyMetrics(), asyncCalls: 8, nestedLoops: 2, lines: 100 };
        assert.ok(calculateRisk(doubled) > calculateRisk(single));
        assert.ok(Math.abs(calculateRiskDensity(doubled) - calculateRiskDensity(single)) < 0.01);
    });

    it("ranks a dense short file above a long plain one", () => {
        // The case the size-driven total gets wrong: a 20-line file full of
        // await inside nested loops versus a 400-line row mapper.
        const dense = { ...emptyMetrics(), asyncCalls: 6, nestedLoops: 2, lines: 20 };
        const plain = { ...emptyMetrics(), mutations: 200, branches: 20, cyclomatic: 21, lines: 400 };
        assert.ok(calculateRisk(plain) > calculateRisk(dense), "precondition: the total prefers the long file");
        assert.ok(calculateRiskDensity(dense) > calculateRiskDensity(plain));
    });

    it("does not let a tiny file spike on a single signal", () => {
        const tiny = { ...emptyMetrics(), asyncCalls: 1, lines: 3 };
        assert.ok(calculateRiskDensity(tiny) < 0.6, "a 3-line file with one await is not maximal risk");
    });

    it("stays in range for a file with no lines counted", () => {
        const score = calculateRiskDensity(emptyMetrics());
        assert.ok(score >= 0 && score < 1, `density out of range: ${score}`);
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

describe("analyzeFile — input limits", () => {
    it("rejects a directory", async () => {
        await assert.rejects(analyzeFile(os.tmpdir()), /Not a file/);
    });

    it("skips a file above the size limit instead of reading it", async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pd-size-"));
        const big = path.join(dir, "big.js");
        // 5 MB of valid JS, above the 4 MB cap.
        await fsp.writeFile(big, "// pad\n".repeat(750_000));
        try {
            const result = await analyzeFile(big);
            assert.match(result.parseError ?? "", /above the .* analysis limit/);
            assert.equal(result.riskScore, 0);
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it("analyses a normal-sized file", async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pd-size-"));
        const small = path.join(dir, "small.js");
        await fsp.writeFile(small, "for (let i=0;i<2;i++) { for (let j=0;j<2;j++) {} }");
        try {
            const result = await analyzeFile(small);
            assert.equal(result.parseError, undefined);
            assert.equal(result.metrics.nestedLoops, 1);
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });
});
