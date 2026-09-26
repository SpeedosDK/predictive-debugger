import fs from "fs/promises";
import { FilePrediction, LogSignal } from "../types";
import type { PredictOptions } from "./predictFile";
import { analyzeSource } from "../analysis/risk";
import { collectCalleeContext } from "../analysis/callees";
import { hasReadAwaitWrite } from "../analysis/staleWrite";
import { analyzeLogs } from "../logs/analyzeLogs";
import { BugInput, predictBugs } from "./predictBug";
import { combineScores } from "./score";
import { isSourceFile } from "../sourceFiles";

/**
 * Default provider calls in flight at once. Each unit is a CLI subprocess
 * hitting a rate limit, not local CPU -- four clears a typical batch in about
 * one call's time without reading as a burst. Callers who know their own
 * limits should pass `concurrency` instead.
 */
export const DEFAULT_CONCURRENCY = 4;

/** Most files prepared and held in memory at once; see predictFiles. */
const PREPARE_WINDOW = 64;
/** File reads and parses in flight while preparing a window. */
const PREPARE_CONCURRENCY = 8;

export interface PredictFilesOptions extends PredictOptions {
    /** Provider calls in flight at once (default {@link DEFAULT_CONCURRENCY}). */
    concurrency?: number;
    onProgress?: (file: string, index: number, total: number) => void;
}

export interface PredictFilesResult {
    /** Successful predictions, in the order the paths were given. */
    results: FilePrediction[];
    /** Paths that threw, with the reason, in the order the paths were given. */
    failures: Array<{ file: string; reason: string }>;
}

/** Bounded source preparation and grouped model calls, with results in request order. */
export async function predictFiles(
    filePaths: string[],
    options: PredictFilesOptions
): Promise<PredictFilesResult> {
    const total = filePaths.length;
    const slots: Array<FilePrediction | { reason: string } | undefined> = new Array(total);
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
        throw new Error("concurrency must be an integer from 1 to 8.");
    }
    let logAnalysis: Promise<LogSignal> | undefined;
    const getLogs = () => logAnalysis ??= options.logs ? analyzeLogs(options.logs)
        : Promise.resolve({ score: 1, anomalyCount: 0, anomalies: [], skipped: "log analysis not requested" });

    // Files are prepared and sent in windows so a large run holds a bounded amount
    // of source. One window covers a typical change set, so its groups and re-checks
    // share one queue instead of waiting on each other.
    for (let start = 0; start < total && !options.signal?.aborted; start += PREPARE_WINDOW) {
        const indexes = Array.from({ length: Math.min(PREPARE_WINDOW, total - start) }, (_, i) => start + i);
        const prepared: Array<{ index: number; input: BugInput; analysis: Awaited<ReturnType<typeof analyzeSource>> }> = [];
        const prepare = async (index: number): Promise<void> => {
            const file = filePaths[index];
            options.onProgress?.(file, index, total);
            // The model provider receives the file's text, so only source files
            // are sent: a path to a .env or key file must never reach it.
            if (!isSourceFile(file)) {
                slots[index] = { reason: `Not a JavaScript/TypeScript source file; only source files are sent to the model: ${file}` };
                return;
            }
            try {
                const code = await readPredictionSource(file);
                const [analysis, callees, recheckIfClean] = await Promise.all([
                    analyzeSource(file, code),
                    options.calleeContext === false ? Promise.resolve([]) : collectCalleeContext(file, code),
                    hasReadAwaitWrite(code)
                ]);
                prepared.push({ index, input: { filePath: file, code, callees, recheckIfClean }, analysis });
            } catch (error) {
                slots[index] = { reason: error instanceof Error ? error.message : String(error) };
            }
        };
        for (let i = 0; i < indexes.length && !options.signal?.aborted; i += PREPARE_CONCURRENCY) {
            await Promise.all(indexes.slice(i, i + PREPARE_CONCURRENCY).map(prepare));
        }
        if (options.signal?.aborted) break;
        prepared.sort((a, b) => a.index - b.index);
        const outcomes = await predictBugs(prepared.map(entry => entry.input), { ...options, concurrency });
        for (const [i, outcome] of outcomes.entries()) {
            const entry = prepared[i];
            if (outcome.kind === "cancelled") continue;
            if (outcome.kind === "failure") {
                slots[entry.index] = { reason: outcome.reason };
                continue;
            }
            try {
                const logs = await getLogs();
                const ai = outcome.assessment;
                slots[entry.index] = { file: entry.input.filePath, metrics: entry.analysis.metrics,
                    riskScore: entry.analysis.riskScore, ai, logs,
                    combinedScore: combineScores(entry.analysis.riskScore, ai.findings[0].score, logs) };
            } catch (error) {
                slots[entry.index] = { reason: error instanceof Error ? error.message : String(error) };
            }
        }
    }

    const results: FilePrediction[] = [];
    const failures: Array<{ file: string; reason: string }> = [];

    for (const [index, slot] of slots.entries()) {
        if (!slot) {
            // Only reachable when the signal aborted mid-batch. The files that
            // did finish are still returned; a cancelled batch is partial, not
            // empty.
            continue;
        }
        if ("reason" in slot) {
            failures.push({ file: filePaths[index], reason: slot.reason });
        } else {
            results.push(slot);
        }
    }

    return { results, failures };
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
