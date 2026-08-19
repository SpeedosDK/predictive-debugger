import { BugPrediction } from "../types";

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
