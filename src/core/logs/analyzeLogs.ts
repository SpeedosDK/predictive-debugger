import fs from "fs";
import path from "path";
import { runProcess } from "../../providers/processRunner";
import { LogAnomaly, LogSignal } from "../types";

const CLEAN: LogSignal = { score: 1, anomalyCount: 0, anomalies: [] };

export interface LogAnalysisOptions {
    /** Absolute path to the log file. Analysis is skipped when unset. */
    logPath?: string;
    /** Absolute path to `analyze_logs.py`. Defaults to the bundled copy. */
    scriptPath?: string;
    /** Python interpreter to use. */
    pythonPath?: string;
    /** Score at or above which a line counts as an anomaly. */
    threshold?: number;
    cwd?: string;
}

interface AnalyzerOutput {
    anomaly_count?: number;
    anomalies?: Array<{ line?: number; text?: string; score?: number; reason?: string }>;
    error?: string;
}

/** Path to the analyzer shipped with this package. */
export function bundledScriptPath(): string {
    // out/core/logs/analyzeLogs.js -> <root>/tools/log-analyzer/analyze_logs.py
    return path.resolve(__dirname, "..", "..", "..", "tools", "log-analyzer", "analyze_logs.py");
}

function defaultInterpreter(): string {
    return (
        process.env.PYTHON_PATH || (process.platform === "win32" ? "py" : "python3")
    );
}

/**
 * Run the log analyzer, if it is configured and available.
 *
 * A missing log file or interpreter is not an error — log data is one optional
 * signal out of three, so we degrade to a clean score and say why.
 */
export async function analyzeLogs(options: LogAnalysisOptions): Promise<LogSignal> {
    const { logPath, pythonPath, cwd, threshold } = options;
    const scriptPath = options.scriptPath ?? bundledScriptPath();

    if (!logPath) {
        return { ...CLEAN, skipped: "no log file configured" };
    }
    if (!fs.existsSync(logPath)) {
        return { ...CLEAN, skipped: `log file not found: ${logPath}` };
    }
    if (!fs.existsSync(scriptPath)) {
        return { ...CLEAN, skipped: `log analyzer not found: ${scriptPath}` };
    }

    const args = [scriptPath, logPath];
    if (threshold !== undefined) {
        args.push("--threshold", String(threshold));
    }

    try {
        const result = await runProcess({
            file: pythonPath || defaultInterpreter(),
            args,
            cwd,
            timeoutMs: 30_000
        });

        if (result.code !== 0) {
            return {
                ...CLEAN,
                skipped: `analyzer exited with code ${result.code}${
                    result.stderr.trim() ? `: ${firstLine(result.stderr)}` : ""
                }`
            };
        }

        const parsed = JSON.parse(result.stdout) as AnalyzerOutput;
        if (parsed.error) {
            return { ...CLEAN, skipped: parsed.error };
        }

        const anomalies: LogAnomaly[] = (parsed.anomalies ?? []).map((entry) => ({
            line: Number(entry.line) || 0,
            text: String(entry.text ?? ""),
            score: Number(entry.score) || 0,
            reason: String(entry.reason ?? "")
        }));
        const anomalyCount = Number(parsed.anomaly_count) || anomalies.length;

        return {
            anomalyCount,
            anomalies,
            score: anomalyCount > 0 ? 1 - Math.min(1, anomalyCount * 0.1) : 1
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ...CLEAN, skipped: `analyzer failed: ${message}` };
    }
}

function firstLine(text: string): string {
    return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}
