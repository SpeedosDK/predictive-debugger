import path from "path";
import * as vscode from "vscode";
import { bundledScriptPath } from "../core/logs/analyzeLogs";
import { predictFile } from "../core/prediction/predictFile";
import { predictProject } from "../core/prediction/predictProject";
import { ActiveProvider, NoProviderError, ProviderRegistry } from "../providers/registry";
import { connectMenu, getConfiguredModel, reportCliError } from "./connectMenu";
import { PredictionReporter, percent, summarize } from "./reporting";

const SUPPORTED_LANGUAGES = new Set([
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
]);

let registry: ProviderRegistry;
let reporter: PredictionReporter;
let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
    registry = new ProviderRegistry(context.globalState);

    const diagnostics = vscode.languages.createDiagnosticCollection("predictiveDebugger");
    const output = vscode.window.createOutputChannel("Predictive Debugger");
    reporter = new PredictionReporter(diagnostics, output);

    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = "predictiveDebugger.connect";

    context.subscriptions.push(
        diagnostics,
        output,
        statusBar,
        vscode.commands.registerCommand("predictiveDebugger.connect", async () => {
            await connectMenu(registry);
            await refreshStatusBar();
        }),
        vscode.commands.registerCommand("predictiveDebugger.predictFile", predictCurrentFile),
        vscode.commands.registerCommand("predictiveDebugger.predictProject", predictWorkspace)
    );

    void refreshStatusBar();
}

export function deactivate(): void {
    reporter?.clear();
}

async function refreshStatusBar(): Promise<void> {
    try {
        const { provider, location } = await registry.resolveActive();
        statusBar.text = `$(pulse) ${provider.label}`;
        statusBar.tooltip = `Predictive Debugger is using ${location.file}`;
    } catch {
        statusBar.text = "$(pulse) Predictive Debugger: not connected";
        statusBar.tooltip = "Click to connect a CLI";
    }
    statusBar.show();
}

/** Resolve the active provider, offering the connect flow when there is none. */
async function requireProvider(): Promise<ActiveProvider | undefined> {
    try {
        return await registry.resolveActive();
    } catch (err) {
        if (err instanceof NoProviderError) {
            const connect = "Connect…";
            if ((await vscode.window.showErrorMessage(err.message, connect)) === connect) {
                await vscode.commands.executeCommand("predictiveDebugger.connect");
            }
            return undefined;
        }
        throw err;
    }
}

async function predictCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a file to analyse first.");
        return;
    }
    if (!SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
        vscode.window.showWarningMessage(
            "Predictive Debugger currently analyses JavaScript and TypeScript files."
        );
        return;
    }

    const active = await requireProvider();
    if (!active) {
        return;
    }

    await editor.document.save();
    const filePath = editor.document.uri.fsPath;

    await withCancellableProgress(
        `Predicting failures in ${path.basename(filePath)}…`,
        active,
        async (signal) => {
            const result = await predictFile(filePath, {
                provider: active.provider,
                location: active.location,
                model: getConfiguredModel(active.provider.id),
                logs: logOptionsFor(editor.document.uri),
                signal
            });

            reporter.publish(editor.document.uri, result);
            reporter.report([result]);
            vscode.window.showInformationMessage(
                `Risk ${percent(result.combinedScore)} — ${summarize(result)}`
            );
        }
    );
}

async function predictWorkspace(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        vscode.window.showWarningMessage("Open a folder to analyse a project.");
        return;
    }

    const active = await requireProvider();
    if (!active) {
        return;
    }

    await withCancellableProgress(
        "Predicting failures across the project…",
        active,
        async (signal, progress) => {
            const result = await predictProject(folder.uri.fsPath, {
                provider: active.provider,
                location: active.location,
                model: getConfiguredModel(active.provider.id),
                logs: logOptionsFor(folder.uri),
                signal,
                maxFiles: vscode.workspace
                    .getConfiguration("predictiveDebugger")
                    .get<number>("maxFiles", 25),
                onProgress: (file, index, total) =>
                    progress.report({
                        message: `${index + 1}/${total} ${path.basename(file)}`
                    })
            });

            reporter.clear();
            for (const file of result.files) {
                reporter.publish(vscode.Uri.file(file.file), file);
            }
            reporter.report(result.files);

            vscode.window.showInformationMessage(
                `Project risk ${percent(result.projectRisk)} across ${result.files.length} files.`
            );
        }
    );
}

async function withCancellableProgress(
    title: string,
    active: ActiveProvider,
    body: (
        signal: AbortSignal,
        progress: vscode.Progress<{ message?: string }>
    ) => Promise<void>
): Promise<void> {
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: true },
        async (progress, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());

            try {
                await body(controller.signal, progress);
            } catch (err) {
                if (!token.isCancellationRequested) {
                    reportCliError(active.provider.label, err);
                }
            }
        }
    );
}

function logOptionsFor(resource: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(resource);
    if (!folder) {
        return undefined;
    }

    const config = vscode.workspace.getConfiguration("predictiveDebugger", resource);
    const configured = config.get<string>("logFile")?.trim();

    return {
        logPath: configured ? path.resolve(folder.uri.fsPath, configured) : undefined,
        scriptPath: bundledScriptPath(),
        pythonPath: config.get<string>("pythonPath")?.trim() || undefined,
        cwd: folder.uri.fsPath
    };
}
