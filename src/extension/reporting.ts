import * as vscode from "vscode";
import {
    isActionablePrediction,
    predictionStatus
} from "../core/prediction/confidence";
import { FilePrediction } from "../core/types";

/** Renders predictions into the Problems panel and the output channel. */
export class PredictionReporter {
    constructor(
        private readonly diagnostics: vscode.DiagnosticCollection,
        private readonly output: vscode.OutputChannel
    ) {}

    clear(): void {
        this.diagnostics.clear();
    }

    /** Put the model's verdict on the line it points at. */
    publish(uri: vscode.Uri, result: FilePrediction): void {
        const { pattern, score, reason, line } = result.aiPrediction;

        if (!isActionablePrediction(result.aiPrediction)) {
            this.diagnostics.set(uri, []);
            return;
        }

        const zeroBased = Math.max(0, (line ?? 1) - 1);
        const partial = result.aiPrediction.truncated
            ? ` [${result.aiPrediction.truncated}]`
            : "";
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(zeroBased, 0, zeroBased, Number.MAX_SAFE_INTEGER),
            `${pattern} (${percent(score)}): ${reason}${partial}`,
            vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = "Predictive Debugger";

        this.diagnostics.set(uri, [diagnostic]);
    }

    report(
        results: FilePrediction[],
        failures: Array<{ file: string; reason: string }> = []
    ): void {
        this.output.appendLine(`--- ${new Date().toLocaleTimeString()} ---`);

        for (const result of results) {
            this.output.appendLine(
                `${percent(result.combinedScore).padStart(4)}  ${result.file}\n` +
                    `      static ${percent(result.riskScore)} · model ${percent(result.aiPrediction.score)} · ${summarize(result)}` +
                    (result.aiPrediction.truncated
                        ? `\n      partial: ${result.aiPrediction.truncated}`
                        : "") +
                    (result.logs.skipped ? `\n      logs: ${result.logs.skipped}` : "")
            );
        }

        for (const failure of failures) {
            this.output.appendLine(`  --  ${failure.file}\n      skipped: ${failure.reason}`);
        }

        this.output.show(true);
    }
}

export function summarize(result: FilePrediction): string {
    const { pattern, score, reason, line } = result.aiPrediction;
    const status = predictionStatus(result.aiPrediction);

    if (status === "none") {
        return "no likely failure found";
    }
    if (status === "unavailable") {
        return reason ? `prediction unavailable: ${reason}` : "prediction unavailable";
    }
    if (status === "uncertain") {
        const at = line ? ` at line ${line}` : "";
        const detail = reason ? `: ${reason}` : "";
        return `uncertain ${pattern}${at} (${percent(score)}, not added to Problems)${detail}`;
    }
    return reason ? `${pattern}: ${reason}` : pattern;
}

export function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
}
