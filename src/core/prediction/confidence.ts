import { BugAssessment, BugPrediction } from "../types";

/**
 * Minimum model confidence for presenting a prediction as a defect.
 *
 * Across three Claude benchmark runs, clean-code noise reached 0.65 while a
 * 0.70 gate kept every observed false alarm out and retained 15/18 planted-bug
 * runs. Keep raw lower-confidence hypotheses available for verbose inspection,
 * but do not turn them into Problems-panel diagnostics or agent conclusions.
 */
export const MIN_ACTIONABLE_SCORE = 0.7;

export type PredictionStatus = "actionable" | "uncertain" | "none" | "unavailable";

/** Turn the model's open-ended verdict into a stable product state. */
export function predictionStatus(
    prediction: Pick<BugPrediction, "pattern" | "score">
): PredictionStatus {
    if (prediction.pattern === "unknown") {
        return "unavailable";
    }
    if (prediction.pattern === "none" || prediction.score <= 0) {
        return "none";
    }
    return prediction.score >= MIN_ACTIONABLE_SCORE ? "actionable" : "uncertain";
}

export function isActionablePrediction(
    prediction: Pick<BugPrediction, "pattern" | "score">
): boolean {
    return predictionStatus(prediction) === "actionable";
}

/**
 * The findings past the precision gate, ranked.
 *
 * The gate is per finding, not per file: a strong first finding does not vouch
 * for a weak second one, and the measurement behind MIN_ACTIONABLE_SCORE was
 * made on individual verdicts.
 */
export function actionableFindings(assessment: BugAssessment): BugPrediction[] {
    return assessment.findings.filter(isActionablePrediction);
}

/**
 * The file-level state, which is the state of its top finding.
 *
 * `findings` is ranked and never empty, so the head is both the most likely
 * defect and — when there is none — the `none` or `unknown` verdict that says
 * so. Nothing about the file is more actionable than its best finding.
 */
export function assessmentStatus(assessment: BugAssessment): PredictionStatus {
    return predictionStatus(assessment.findings[0]);
}
