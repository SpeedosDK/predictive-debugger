import fs from "fs/promises";
import { CliLocation, CliProvider } from "../../providers/types";
import { analyzeSource } from "../analysis/risk";
import { analyzeLogs, LogAnalysisOptions } from "../logs/analyzeLogs";
import { FilePrediction } from "../types";
import { predictBug } from "./predictBug";
import { combineScores } from "./score";

export interface PredictOptions {
    provider: CliProvider;
    location: CliLocation;
    model?: string;
    logs?: LogAnalysisOptions;
    signal?: AbortSignal;
}

/**
 * Full pipeline for one file: static complexity, the model's verdict, and log
 * anomalies, combined into a single risk score by `combineScores`.
 *
 * This makes a model call. Agents that are themselves a model should prefer
 * `analyzeFile` from `core/analysis/risk`, which is deterministic and free.
 */
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

    const combinedScore = combineScores(staticAnalysis.riskScore, aiPrediction.score, logs);

    return {
        file: filePath,
        metrics: staticAnalysis.metrics,
        riskScore: staticAnalysis.riskScore,
        aiPrediction,
        logs,
        combinedScore
    };
}
