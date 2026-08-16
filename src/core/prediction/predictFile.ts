import fs from "fs/promises";
import { CliLocation, CliProvider } from "../../providers/types";
import { analyzeSource } from "../analysis/risk";
import { analyzeLogs, LogAnalysisOptions } from "../logs/analyzeLogs";
import { FilePrediction } from "../types";
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

    // Log health raises the score, so invert it into a risk contribution.
    const combinedScore = Math.min(
        1,
        staticAnalysis.riskScore * 0.4 + aiPrediction.score * 0.4 + (1 - logs.score) * 0.2
    );

    return {
        file: filePath,
        metrics: staticAnalysis.metrics,
        riskScore: staticAnalysis.riskScore,
        aiPrediction,
        logs,
        combinedScore
    };
}
