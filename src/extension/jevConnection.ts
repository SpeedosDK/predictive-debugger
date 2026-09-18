import * as vscode from "vscode";
import { createJevReviewer, JevReviewer, validJevKey } from "../core/prediction/jev";

const SECRET = "predictiveDebugger.typesafeApiKey";

export function registerJevConnection(context: Pick<vscode.ExtensionContext, "secrets" | "subscriptions">): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("predictiveDebugger.connectJev", async () => {
            if (!vscode.workspace.isTrusted) return;
            const key = await vscode.window.showInputBox({
                title: "Connect Typesafe Jev scoring",
                prompt: "Enable paid scoring on predictions: bounded source, imported definitions and findings are sent to Typesafe. The key is stored in VS Code SecretStorage. Disconnect Jev to stop.",
                password: true, ignoreFocusOut: true,
                validateInput: value => validJevKey(value.trim()) ? undefined : "Enter a valid API key without spaces or control characters."
            });
            if (key === undefined || !validJevKey(key.trim())) return;
            try {
                await context.secrets.store(SECRET, key.trim());
                void vscode.window.showInformationMessage("Jev scoring enabled. The key will be checked on the next prediction.");
            } catch {
                void vscode.window.showErrorMessage("Could not store the Jev key in VS Code SecretStorage.");
            }
        }),
        vscode.commands.registerCommand("predictiveDebugger.disconnectJev", async () => {
            try {
                await context.secrets.delete(SECRET);
                void vscode.window.showInformationMessage("Jev scoring disconnected. New predictions use the CLI only.");
            } catch {
                void vscode.window.showErrorMessage("Could not remove the Jev key from VS Code SecretStorage.");
            }
        })
    );
}

export async function connectedJev(secrets: vscode.SecretStorage): Promise<JevReviewer | undefined> {
    if (!vscode.workspace.isTrusted) return undefined;
    try {
        const apiKey = await secrets.get(SECRET);
        return apiKey ? createJevReviewer({ apiKey }) : undefined;
    } catch {
        void vscode.window.showWarningMessage("Could not read Jev credentials. Continuing with the CLI prediction.");
        return undefined;
    }
}
