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

/** Heuristic complexity score in [0, 1], independent of any model. */
export function calculateRisk(metrics: FileMetrics): number {
    const score = WEIGHTS.reduce(
        (total, { key, weight }) => total + metrics[key] * weight,
        0
    );
    return Math.min(score, 1);
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
 * Deterministic analysis of one file: no model call, no network, no credentials.
 * This is what agents should reach for when reviewing code.
 */
export async function analyzeFile(filePath: string): Promise<StaticAnalysis> {
    const code = await fs.readFile(filePath, "utf8");
    return analyzeSource(filePath, code);
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
