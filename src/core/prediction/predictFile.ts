import fs from "fs/promises";
import { CliLocation, CliProvider } from "../../providers/types";
import { analyzeSource } from "../analysis/risk";
import { analyzeLogs, LogAnalysisOptions } from "../logs/analyzeLogs";
import { FilePrediction, LogSignal } from "../types";
import { predictBug } from "./predictBug";

export interface PredictOptions {
    provider: CliProvider;
    location: CliLocation;
    model?: string;
    logs?: LogAnalysisOptions;
    signal?: AbortSignal;
}

/**
 * Full pipeline for one file: static complexity, the model's verdict, and log
 * anomalies, combined into a single risk score.
 *
 * This makes a model call. Agents that are themselves a model should prefer
 * `analyzeFile` from `core/analysis/risk`, which is deterministic and free.
 */
/**
 * Blend the three signals into the headline score.
 *
 * The model verdict dominates, and deliberately so. On the benchmark corpus the
 * static complexity score separates buggy files from clean ones with an AUC of
 * 0.33 — worse than a coin toss, because complexity tracks file length and half
 * the planted bugs are in short files. The previous 0.4/0.4/0.2 blend dragged
 * the combined score down to AUC 0.74 from the model verdict's own 0.91, and
 * ranked a clean 200-line service above four of the six real defects. It also
 * capped the score at 0.8 whenever no log file was supplied, since the log term
 * then contributed nothing.
 *
 * Complexity is kept as a small prior — it is cheap, and on a real repository it
 * is weakly informative rather than actively misleading — but it can no longer
 * outvote the verdict. Log evidence is folded in only when it exists, and the
 * remaining weight is renormalised so the score still spans the full range.
 */
function combine(riskScore: number, aiScore: number, logs: LogSignal): number {
    const AI = 0.9;
    const STATIC = 0.1;
    const LOGS = 0.15;

    if (logs.skipped) {
        return Math.min(1, aiScore * AI + riskScore * STATIC);
    }

    const scale = 1 - LOGS;
    return Math.min(
        1,
        aiScore * AI * scale + riskScore * STATIC * scale + (1 - logs.score) * LOGS
    );
}

export async function predictFile(
    filePath: string,
    options: PredictOptions
): Promise<FilePrediction> {
    const code = await fs.readFile(filePath, "utf8");
    const staticAnalysis = await analyzeSource(filePath, code);

    const aiPrediction = await predictBug({
        provider: options.provider,
        location: options.location,
        filePath,
        code,
        model: options.model,
        signal: options.signal
    });

    const logs = options.logs
        ? await analyzeLogs(options.logs)
        : { score: 1, anomalyCount: 0, anomalies: [], skipped: "log analysis not requested" };

    const combinedScore = combine(staticAnalysis.riskScore, aiPrediction.score, logs);

    return {
        file: filePath,
        metrics: staticAnalysis.metrics,
        riskScore: staticAnalysis.riskScore,
        aiPrediction,
        logs,
        combinedScore
    };
}
