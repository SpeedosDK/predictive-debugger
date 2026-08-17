import fs from "fs/promises";
import { FileMetrics, StaticAnalysis } from "../types";
import { collectMetrics, emptyMetrics } from "./ast";

interface Weight {
    key: keyof FileMetrics;
    weight: number;
    label: (n: number) => string;
}

const WEIGHTS: Weight[] = [
    { key: "longFunctions", weight: 0.15, label: (n) => `${n} function(s) longer than 20 statements` },
    { key: "nestedLoops", weight: 0.2, label: (n) => `${n} nested loop(s)` },
    { key: "asyncCalls", weight: 0.1, label: (n) => `${n} async boundary/boundaries (await, timers)` },
    { key: "mutations", weight: 0.1, label: (n) => `${n} mutation(s) of existing state` },
    { key: "branches", weight: 0.05, label: (n) => `${n} branch(es)` },
    { key: "tryCatch", weight: 0.05, label: (n) => `${n} try/catch block(s)` },
    { key: "cyclomatic", weight: 0.02, label: (n) => `cyclomatic complexity ${n}` }
];

/**
 * Half-saturation constant: the raw weighted sum that maps to 0.5.
 *
 * Tuned so ordinary application files land in the middle of the range rather
 * than pinned at the top — a file with, say, a dozen branches and a few async
 * boundaries should look moderate, not maximal.
 */
const HALF_SATURATION = 2.5;

/** Raw weighted sum of the risk signals. Unbounded; use calculateRisk instead. */
function rawRisk(metrics: FileMetrics): number {
    return WEIGHTS.reduce((total, { key, weight }) => total + metrics[key] * weight, 0);
}

/**
 * Heuristic complexity score in [0, 1), independent of any model.
 *
 * Uses a smooth saturation (`x / (x + k)`) rather than clamping the weighted
 * sum. Clamping made every non-trivial real-world file score exactly 1, which
 * destroyed the ranking that `scan_project` exists to provide. Saturation is
 * strictly monotonic, so two heavy files always compare correctly no matter how
 * complex they get, and it can never exceed 1 by construction.
 */
export function calculateRisk(metrics: FileMetrics): number {
    const raw = rawRisk(metrics);
    return raw / (raw + HALF_SATURATION);
}

/** The signals that contributed most to the score, biggest first. */
export function explainRisk(metrics: FileMetrics): string[] {
    return WEIGHTS.filter(({ key }) => metrics[key] > 0)
        .map(({ key, weight, label }) => ({
            contribution: metrics[key] * weight,
            text: label(metrics[key])
        }))
        .sort((a, b) => b.contribution - a.contribution)
        .map((entry) => entry.text);
}

/**
 * Largest file we will read into memory. The MCP server accepts arbitrary paths
 * from the calling agent, so an unbounded read is a denial-of-service waiting to
 * happen — a generated bundle or an accidentally-matched blob would exhaust the
 * heap. Well past any hand-written source file.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Deterministic analysis of one file: no model call, no network, no credentials.
 * This is what agents should reach for when reviewing code.
 */
export async function analyzeFile(filePath: string): Promise<StaticAnalysis> {
    const stat = await fs.stat(filePath);

    if (!stat.isFile()) {
        throw new Error(`Not a file: ${filePath}`);
    }
    if (stat.size > MAX_FILE_BYTES) {
        const reason = `file is ${Math.round(stat.size / 1024)} KB, above the ${MAX_FILE_BYTES / 1024 / 1024} MB analysis limit`;
        return {
            file: filePath,
            metrics: emptyMetrics(),
            riskScore: 0,
            signals: [`skipped: ${reason}`],
            parseError: reason
        };
    }

    return analyzeSource(filePath, await fs.readFile(filePath, "utf8"));
}

export async function analyzeSource(
    filePath: string,
    code: string
): Promise<StaticAnalysis> {
    let metrics: FileMetrics;

    try {
        metrics = await collectMetrics(code);
    } catch (err) {
        // Babel's errorRecovery handles most damage, but not all of it. A file
        // we cannot parse must not abort a whole project scan, so report it as
        // a zero-risk result carrying the reason.
        const reason = err instanceof Error ? err.message : String(err);
        const empty = emptyMetrics();
        return {
            file: filePath,
            metrics: empty,
            riskScore: 0,
            signals: [`could not be parsed: ${reason}`],
            parseError: reason
        };
    }

    return {
        file: filePath,
        metrics,
        riskScore: calculateRisk(metrics),
        signals: explainRisk(metrics)
    };
}
