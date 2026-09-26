import { CliLocation, CliProvider } from "../../providers/types";
import { LogAnalysisOptions } from "../logs/analyzeLogs";
import { FilePrediction } from "../types";
import { predictFiles } from "./predictFiles";

export interface PredictOptions {
    provider: CliProvider;
    location: CliLocation;
    model?: string;
    logs?: LogAnalysisOptions;
    signal?: AbortSignal;
    /**
     * Send bounded imported definitions and referenced type contracts
     * (default true). Turning it off restores single-file scope, which is
     * cheaper per call and measurably less accurate — see issue #4.
     */
    calleeContext?: boolean;
    /**
     * Ask for every demonstrable finding rather than the single most likely one
     * (default false). See `PredictBugOptions.multi` and issue #7.
     */
    multi?: boolean;
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
    const { results, failures } = await predictFiles([filePath], options);
    if (results[0]) return results[0];
    throw new Error(failures[0]?.reason ?? "Cancelled");
}
