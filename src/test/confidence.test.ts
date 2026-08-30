import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    actionableFindings,
    assessmentStatus,
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

describe("gating a list of findings", () => {
    it("applies the gate to each finding, not to the file", () => {
        // A strong first finding does not vouch for a weak second one, and the
        // measurement behind MIN_ACTIONABLE_SCORE was made on single verdicts.
        const actionable = actionableFindings({
            findings: [
                { pattern: "race_condition", score: 0.9, reason: "a" },
                { pattern: "off_by_one", score: 0.5, reason: "b" },
                { pattern: "resource_leak", score: 0.75, reason: "c" }
            ]
        });

        assert.deepEqual(
            actionable.map((f) => f.pattern),
            ["race_condition", "resource_leak"]
        );
    });

    it("returns nothing when no finding clears the gate", () => {
        assert.deepEqual(
            actionableFindings({ findings: [{ pattern: "off_by_one", score: 0.5, reason: "b" }] }),
            []
        );
    });

    it("takes the file's status from its top finding", () => {
        assert.equal(
            assessmentStatus({
                findings: [
                    { pattern: "race_condition", score: 0.9, reason: "a" },
                    { pattern: "off_by_one", score: 0.5, reason: "b" }
                ]
            }),
            "actionable"
        );
        assert.equal(
            assessmentStatus({ findings: [{ pattern: "none", score: 0, reason: "" }] }),
            "none"
        );
        assert.equal(
            assessmentStatus({ findings: [{ pattern: "unknown", score: 0, reason: "x" }] }),
            "unavailable"
        );
    });

    it("does not let a list of weak findings add up to an actionable file", () => {
        assert.equal(
            assessmentStatus({
                findings: [
                    { pattern: "off_by_one", score: 0.6, reason: "a" },
                    { pattern: "resource_leak", score: 0.55, reason: "b" },
                    { pattern: "null_reference", score: 0.5, reason: "c" }
                ]
            }),
            "uncertain"
        );
    });
});
