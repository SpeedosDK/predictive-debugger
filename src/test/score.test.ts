import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { combineScores, SCORE_WEIGHTS } from "../core/prediction/score";

const NO_LOGS = { score: 1, skipped: "log analysis not requested" };
const CLEAN_LOGS = { score: 1 };
const NOISY_LOGS = { score: 0 };

describe("combineScores", () => {
    it("lets the model verdict dominate the static prior", () => {
        // A complex file the model cleared must rank below a plain file it flagged.
        const clearedButComplex = combineScores(1, 0, NO_LOGS);
        const flaggedButPlain = combineScores(0, 1, NO_LOGS);

        assert.equal(clearedButComplex, SCORE_WEIGHTS.static);
        assert.equal(flaggedButPlain, SCORE_WEIGHTS.ai);
        assert.ok(flaggedButPlain > clearedButComplex);
    });

    it("spans the full range when no log file was supplied", () => {
        // Regression guard: an earlier blend reserved weight for a log term that
        // could never contribute, so a certain verdict on a complex file capped
        // out at 0.8 and no file could ever score 1.
        assert.equal(combineScores(1, 1, NO_LOGS), 1);
    });

    it("renormalises the other weights when logs are folded in", () => {
        const scale = 1 - SCORE_WEIGHTS.logs;

        // Clean logs are evidence of health, so they hold the ceiling down.
        assert.equal(
            combineScores(1, 1, CLEAN_LOGS),
            SCORE_WEIGHTS.ai * scale + SCORE_WEIGHTS.static * scale
        );
        // Anomalous logs contribute the full log weight and restore the ceiling.
        assert.equal(combineScores(1, 1, NOISY_LOGS), 1);
    });

    it("lets log anomalies raise the score of a file the model cleared", () => {
        assert.ok(combineScores(0, 0, NOISY_LOGS) > combineScores(0, 0, CLEAN_LOGS));
    });

    it("stays inside [0, 1] for out-of-range and non-finite input", () => {
        assert.equal(combineScores(5, 5, NO_LOGS), 1);
        assert.equal(combineScores(-5, -5, NO_LOGS), 0);
        assert.equal(combineScores(Number.NaN, 1, NO_LOGS), 0);
        assert.equal(combineScores(1, Number.POSITIVE_INFINITY, CLEAN_LOGS), 0);
    });
});
