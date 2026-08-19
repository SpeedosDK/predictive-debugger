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

/**
 * Weights for risk *density*, which answers a different question than
 * `WEIGHTS`: not "how much is going on in this file" but "how concentrated is
 * the dangerous kind of code".
 *
 * Mutations, branches and cyclomatic complexity are almost linear in file
 * length — every file accumulates them simply by existing — so at full weight
 * they turn a per-line score into a measure of how assignment-heavy the file
 * is, which ranks plain row mappers at the top. They are kept, because a branch
 * is still a decision point, but damped to roughly a tenth of their weight in
 * the total. The structural signals that do not scale with length — nested
 * loops, async boundaries, long functions, try/catch — carry the ranking.
 *
 * Measured on bench/corpus: this ordering puts the planted bugs at ranks
 * 4, 9, 11, 12 out of 40 versus 11, 14, 17, 38 for the size-driven total.
 * Fitted on six bugs, so treat it as a hypothesis — see bench/RESULTS.md.
 */
const DENSITY_WEIGHTS: Weight[] = [
    { key: "longFunctions", weight: 0.15, label: (n) => `${n} function(s) longer than 20 statements` },
    { key: "nestedLoops", weight: 0.2, label: (n) => `${n} nested loop(s)` },
    { key: "asyncCalls", weight: 0.1, label: (n) => `${n} async boundary/boundaries (await, timers)` },
    { key: "tryCatch", weight: 0.05, label: (n) => `${n} try/catch block(s)` },
    { key: "mutations", weight: 0.01, label: (n) => `${n} mutation(s) of existing state` },
    { key: "branches", weight: 0.005, label: (n) => `${n} branch(es)` },
    { key: "cyclomatic", weight: 0.005, label: (n) => `cyclomatic complexity ${n}` }
];

/**
 * Half-saturation for density, in weighted units per 100 lines. Chosen so the
 * median file in a normal application tree lands near 0.5 rather than bunched
 * against either end.
 */
const HALF_SATURATION_DENSITY = 1.0;

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

/**
 * Heuristic risk per 100 lines, in [0, 1).
 *
 * `calculateRisk` grows with file length, so ranking by it is close to ranking
 * by size: on the benchmark corpus its rank correlation with raw file size is
 * 0.82, and it ranks the two smallest planted bugs 38th and 39th of 40. That
 * is the correct answer to "which file contains the most risk" and the wrong
 * answer to "which file should I read first", because the agent pays per token
 * and a defect in a 14-line file costs almost nothing to check.
 *
 * Density answers the second question. Files too short to say anything about
 * are damped towards 0 rather than allowed to spike on a single await.
 */
export function calculateRiskDensity(metrics: FileMetrics): number {
    const raw = DENSITY_WEIGHTS.reduce(
        (total, { key, weight }) => total + metrics[key] * weight,
        0
    );
    // A 5-line file with one await is not denser than a 50-line file with ten;
    // the floor stops tiny files from dominating the ranking on one signal.
    const per100 = (raw / Math.max(metrics.lines, 10)) * 100;
    return per100 / (per100 + HALF_SATURATION_DENSITY);
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
            riskDensity: 0,
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
            riskDensity: 0,
            signals: [`could not be parsed: ${reason}`],
            parseError: reason
        };
    }

    return {
        file: filePath,
        metrics,
        riskScore: calculateRisk(metrics),
        riskDensity: calculateRiskDensity(metrics),
        signals: explainRisk(metrics)
    };
}
