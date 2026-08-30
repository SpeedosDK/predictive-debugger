import * as vscode from "vscode";
import {
    actionableFindings,
    assessmentStatus
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

    /**
     * Put each finding on the line it points at.
     *
     * One diagnostic per finding rather than one per file: the Problems panel
     * is a list of things to fix, and collapsing several into the first would
     * hide the rest behind a fix for something else.
     */
    publish(uri: vscode.Uri, result: FilePrediction): void {
        const partial = result.ai.truncated ? ` [${result.ai.truncated}]` : "";

        const diagnostics = actionableFindings(result.ai).map((finding) => {
            const zeroBased = Math.max(0, (finding.line ?? 1) - 1);
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(zeroBased, 0, zeroBased, Number.MAX_SAFE_INTEGER),
                `${finding.pattern} (${percent(finding.score)}): ${finding.reason}${partial}`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = "Predictive Debugger";
            return diagnostic;
        });

        this.diagnostics.set(uri, diagnostics);
    }

    report(
        results: FilePrediction[],
        failures: Array<{ file: string; reason: string }> = []
    ): void {
        this.output.appendLine(`--- ${new Date().toLocaleTimeString()} ---`);

        for (const result of results) {
            this.output.appendLine(
                `${percent(result.combinedScore).padStart(4)}  ${result.file}\n` +
                    `      static ${percent(result.riskScore)} · model ${percent(result.ai.findings[0].score)} · ${summarize(result)}` +
                    result.ai.findings
                        .slice(1)
                        .map((finding) => `\n      also ${describeFinding(finding)}`)
                        .join("") +
                    (result.ai.truncated ? `\n      partial: ${result.ai.truncated}` : "") +
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
    const { pattern, score, reason, line } = result.ai.findings[0];
    const status = assessmentStatus(result.ai);

    if (status === "none") {
        // The one place the coverage self-report earns its space: a clean
        // verdict is exactly where the reader cannot otherwise tell a thorough
        // pass from a cursory one.
        return `no likely failure found${describeChecked(result)}`;
    }
    if (status === "unavailable") {
        return reason ? `prediction unavailable: ${reason}` : "prediction unavailable";
    }
    if (status === "uncertain") {
        const at = line ? ` at line ${line}` : "";
        const detail = reason ? `: ${reason}` : "";
        return `uncertain ${pattern}${at} (${percent(score)}, not added to Problems)${detail}${describeChecked(result)}`;
    }
    return reason ? `${pattern}: ${reason}` : pattern;
}

/** The one-line form used for the findings below the first. */
function describeFinding(finding: FilePrediction["ai"]["findings"][number]): string {
    const at = finding.line ? ` at line ${finding.line}` : "";
    const detail = finding.reason ? `: ${finding.reason}` : "";
    return `${finding.pattern}${at} (${percent(finding.score)})${detail}`;
}

/** Name what the model says it weighed, or say plainly that it said nothing. */
function describeChecked(result: FilePrediction): string {
    const checked = result.ai.checked;
    return checked?.length
        ? ` (checked: ${checked.join(", ")})`
        : " (the model reported no coverage)";
}

export function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
}
