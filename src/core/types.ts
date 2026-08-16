export interface FileMetrics {
    functions: number;
    longFunctions: number;
    branches: number;
    asyncCalls: number;
    nestedLoops: number;
    mutations: number;
    tryCatch: number;
    cyclomatic: number;
}

/** A deterministic, model-free assessment of one file. */
export interface StaticAnalysis {
    file: string;
    metrics: FileMetrics;
    /** Heuristic complexity risk in [0, 1]. */
    riskScore: number;
    /** Human-readable notes about what drove the score. */
    signals: string[];
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
}
