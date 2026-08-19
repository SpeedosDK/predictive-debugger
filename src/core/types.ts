export interface FileMetrics {
    functions: number;
    longFunctions: number;
    branches: number;
    asyncCalls: number;
    nestedLoops: number;
    mutations: number;
    tryCatch: number;
    cyclomatic: number;
    /** Physical lines, so risk can be expressed per unit of code. */
    lines: number;
}

/** A deterministic, model-free assessment of one file. */
export interface StaticAnalysis {
    file: string;
    metrics: FileMetrics;
    /** Heuristic complexity risk in [0, 1]. Grows with the size of the file. */
    riskScore: number;
    /**
     * Heuristic risk per unit of code, in [0, 1]. Independent of file length,
     * so it ranks a dense 20-line file above a long but plain one. This is the
     * ordering `scan_project` uses; see bench/RESULTS.md section 5.
     */
    riskDensity: number;
    /** Human-readable notes about what drove the score. */
    signals: string[];
    /**
     * Set when the file could not be parsed. Metrics are zeroed in that case;
     * the file is reported rather than silently skipped.
     */
    parseError?: string;
}

export interface BugPrediction {
    /** Identifier from the bug pattern catalogue, or "none". */
    pattern: string;
    /** 0 = looks safe, 1 = very likely to fail. */
    score: number;
    /** One-sentence explanation from the model. */
    reason: string;
    /** 1-based line the model points at, when it identifies one. */
    line?: number;
    /**
     * Set when the file was too large to send in full. The verdict is then based
     * on a prefix of the file, which the caller should make visible.
     */
    truncated?: string;
}

export interface LogAnomaly {
    line: number;
    text: string;
    /** 0 = normal, 1 = highly anomalous. */
    score: number;
    reason: string;
}

export interface LogSignal {
    /** 0 = many anomalies, 1 = clean. */
    score: number;
    anomalyCount: number;
    anomalies: LogAnomaly[];
    /** Set when log analysis was skipped rather than run. */
    skipped?: string;
}

export interface FilePrediction {
    file: string;
    metrics: FileMetrics;
    riskScore: number;
    aiPrediction: BugPrediction;
    logs: LogSignal;
    combinedScore: number;
}

export interface ProjectPrediction {
    projectRisk: number;
    files: FilePrediction[];
    /** Files that could not be analysed at all, with the reason why. */
    failures: Array<{ file: string; reason: string }>;
}
