import * as vscode from "vscode";
import { CliError, ProviderId } from "../providers/types";
import { DetectedProvider, ProviderRegistry } from "../providers/registry";

interface ProviderQuickPickItem extends vscode.QuickPickItem {
    detected: DetectedProvider;
}

const MODEL_SETTINGS: Record<ProviderId, string> = {
    claude: "claudeModel",
    codex: "codexModel",
    copilot: "copilotModel"
};

/** Model override for a provider, if the user configured one. */
export function getConfiguredModel(id: ProviderId): string | undefined {
    const value = vscode.workspace
        .getConfiguration("predictiveDebugger")
        .get<string>(MODEL_SETTINGS[id]);
    return value?.trim() || undefined;
}

export async function connectMenu(registry: ProviderRegistry): Promise<void> {
    const detected = await registry.detectAll();
    const selectedId = registry.getSelectedId();

    const items: ProviderQuickPickItem[] = detected.map((entry) => {
        const { provider, location } = entry;
        const installed = Boolean(location);

        return {
            label: `${installed ? "$(check)" : "$(circle-slash)"} ${provider.label}`,
            description: location?.version
                ? `v${location.version}`
                : installed
                  ? "installed"
                  : "not installed",
            detail: describe(entry),
            picked: provider.id === selectedId,
            detected: entry
        };
    });

    const choice = await vscode.window.showQuickPick(items, {
        title: "Connect Predictive Debugger",
        placeHolder: "Pick the CLI whose account should power predictions"
    });

    if (!choice) {
        return;
    }

    const { provider, location, auth } = choice.detected;

    if (!location) {
        vscode.window.showWarningMessage(
            `${provider.label} is not installed. ${provider.installHint}`
        );
        return;
    }

    if (!auth.hasCredentials) {
        const signIn = "How do I sign in?";
        const answer = await vscode.window.showWarningMessage(
            `${provider.label} is installed but not signed in.`,
            signIn,
            "Try anyway"
        );
        if (answer === signIn) {
            vscode.window.showInformationMessage(provider.installHint);
            return;
        }
        if (answer !== "Try anyway") {
            return;
        }
    }

    const verified = await verify(choice.detected);
    if (!verified) {
        return;
    }

    await registry.setSelectedId(provider.id);
    vscode.window.showInformationMessage(
        `Connected via ${provider.label}. Predictions will use your signed-in account.`
    );
}

async function verify(detected: DetectedProvider): Promise<boolean> {
    const { provider, location } = detected;
    if (!location) {
        return false;
    }

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Checking your ${provider.label} sign-in…`,
            cancellable: true
        },
        async (_progress, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());

            try {
                const reply = await provider.complete(location, {
                    prompt:
                        "Reply with exactly the word OK. No punctuation, no explanation.",
                    model: getConfiguredModel(provider.id),
                    timeoutMs: 120_000,
                    signal: controller.signal
                });

                if (!reply.trim()) {
                    vscode.window.showErrorMessage(
                        `${provider.label} responded, but the reply was empty.`
                    );
                    return false;
                }
                return true;
            } catch (err) {
                if (token.isCancellationRequested) {
                    return false;
                }
                reportCliError(provider.label, err);
                return false;
            }
        }
    );
}

function describe(entry: DetectedProvider): string {
    const { provider, location, auth } = entry;

    if (!location) {
        return provider.installHint;
    }
    if (!auth.hasCredentials) {
        return `Signed out — ${provider.installHint}`;
    }
    return `Signed in (${auth.credentialsPath ?? "credentials found"})`;
}

export function reportCliError(label: string, err: unknown): void {
    if (err instanceof CliError) {
        const detail = err.stderr ? ` ${firstLine(err.stderr)}` : "";
        vscode.window.showErrorMessage(`${err.message}${detail}`);
        return;
    }

    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`${label} failed: ${message}`);
}

function firstLine(text: string): string {
    const line = text.split(/\r?\n/).find((l) => l.trim());
    return line ? line.trim() : "";
}
