import fs from "fs/promises";
import { CliLocation, CliProvider } from "../../providers/types";
import { collectCalleeContext } from "../analysis/callees";
import { analyzeSource } from "../analysis/risk";
import { analyzeLogs, LogAnalysisOptions } from "../logs/analyzeLogs";
import { FilePrediction, LogSignal } from "../types";
import { predictBug } from "./predictBug";
import { combineScores } from "./score";
import { JevReviewer } from "./jev";

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
    jev?: JevReviewer;
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
    return createFilePredictor(options)(filePath);
}

/** A batch shares one lazy log analysis, including concurrent requests. */
export function createFilePredictor(
    options: PredictOptions
): (filePath: string) => Promise<FilePrediction> {
    let logAnalysis: Promise<LogSignal> | undefined;
    const getLogs = () => {
        logAnalysis ??= options.logs
            ? analyzeLogs(options.logs)
            : Promise.resolve({
                score: 1, anomalyCount: 0, anomalies: [], skipped: "log analysis not requested"
            });
        return logAnalysis;
    };
    return (filePath) => predictWithLogs(filePath, options, getLogs);
}

async function predictWithLogs(
    filePath: string,
    options: PredictOptions,
    getLogs: () => Promise<LogSignal>
): Promise<FilePrediction> {
    const code = await readPredictionSource(filePath);
    const staticAnalysis = await analyzeSource(filePath, code);

    // Resolution is here rather than inside predictBug so the prompt builder
    // stays a pure function of its inputs, testable without a filesystem.
    const callees =
        options.calleeContext === false ? [] : await collectCalleeContext(filePath, code);

    const ai = await predictBug({
        provider: options.provider,
        location: options.location,
        filePath,
        code,
        callees,
        multi: options.multi,
        model: options.model,
        signal: options.signal
    });

    const logs = await getLogs();
    const jev = options.jev
        ? await options.jev({ code, callees, assessment: ai, signal: options.signal })
        : undefined;

    // The headline score follows the top finding. A file's risk is set by its
    // worst demonstrable defect, not by how many the model chose to list.
    const combinedScore = combineScores(
        staticAnalysis.riskScore,
        ai.findings[0].score,
        logs
    );

    return {
        file: filePath,
        metrics: staticAnalysis.metrics,
        riskScore: staticAnalysis.riskScore,
        ai,
        logs,
        combinedScore,
        ...(jev ? { jev } : {})
    };
}

async function readPredictionSource(filePath: string): Promise<string> {
    const limit = 4 * 1024 * 1024;
    const handle = await fs.open(filePath, "r");
    try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
        const tooLarge = () => new Error(`File exceeds the 4 MB prediction limit: ${filePath}`);
        if (stat.size > limit) throw tooLarge();
        // Bound the read as well as the stat: a file can grow while being read.
        const buffer = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        if (length > limit) throw tooLarge();
        return buffer.toString("utf8", 0, length);
    } finally {
        await handle.close();
    }
}
