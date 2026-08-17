import * as vscode from "vscode";
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

        if (pattern === "none" || score <= 0) {
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
            result.combinedScore >= 0.6
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information
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
    const { pattern, reason } = result.aiPrediction;
    if (pattern === "none") {
        return "no likely failure found";
    }
    return reason ? `${pattern}: ${reason}` : pattern;
}

export function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
}
