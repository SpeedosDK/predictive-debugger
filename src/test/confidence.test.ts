import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    isActionablePrediction,
    MIN_ACTIONABLE_SCORE,
    predictionStatus
} from "../core/prediction/confidence";

describe("isActionablePrediction", () => {
    it("accepts a concrete prediction at the measured precision gate", () => {
        assert.equal(MIN_ACTIONABLE_SCORE, 0.7);
        assert.equal(isActionablePrediction({ pattern: "off_by_one", score: 0.7 }), true);
    });

    it("keeps lower-confidence hypotheses from becoming defect reports", () => {
        assert.equal(isActionablePrediction({ pattern: "null_reference", score: 0.69 }), false);
    });

    it("never treats clean or unparsable verdicts as actionable", () => {
        assert.equal(isActionablePrediction({ pattern: "none", score: 1 }), false);
        assert.equal(isActionablePrediction({ pattern: "unknown", score: 1 }), false);
    });

    it("keeps a named low-confidence hypothesis visible as uncertain", () => {
        assert.equal(predictionStatus({ pattern: "race_condition", score: 0.55 }), "uncertain");
    });

    it("distinguishes no finding from an unavailable model verdict", () => {
        assert.equal(predictionStatus({ pattern: "none", score: 0 }), "none");
        assert.equal(predictionStatus({ pattern: "unknown", score: 0 }), "unavailable");
    });
});
