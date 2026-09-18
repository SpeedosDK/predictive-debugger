import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { it } from "node:test";
import type * as vscode from "vscode";
import * as jev from "../core/prediction/jev";
import type * as connection from "../extension/jevConnection";

it("connects and disconnects Jev through masked input and SecretStorage, respecting trust and cancellation", async () => {
    const commands = new Map<string, () => Promise<void>>();
    const stored = new Map<string, string>();
    const messages: string[] = [];
    let value: string | undefined = "test-key";
    let prompts = 0;
    let failStorage = false;
    const workspace = { isTrusted: true };
    const secrets: vscode.SecretStorage = {
        onDidChange: () => ({ dispose() {} }),
        get: async (key: string) => {
            if (failStorage) throw new Error("test-key sensitive error");
            return stored.get(key);
        },
        store: async (key: string, secret: string) => { stored.set(key, secret); },
        delete: async (key: string) => { stored.delete(key); }
    };
    // Load the compiled extension command with only the unavailable VS Code host replaced.
    const exports: typeof connection = {
        registerJevConnection: () => { throw new Error("Module did not load"); },
        connectedJev: async () => { throw new Error("Module did not load"); }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../extension/jevConnection.js"), "utf8"), {
        exports,
        require: (name: string) => {
            if (name === "../core/prediction/jev") return jev;
            assert.equal(name, "vscode");
            return { workspace, commands: {
                registerCommand: (id: string, callback: () => Promise<void>) => { commands.set(id, callback); return { dispose() {} }; }
            }, window: {
                showInputBox: async (options: vscode.InputBoxOptions) => {
                    prompts++;
                    assert.equal(options.password, true);
                    assert.match(options.prompt ?? "", /sent to Typesafe/);
                    assert.equal(options.value, undefined);
                    return value;
                },
                showInformationMessage: (message: string) => messages.push(message),
                showWarningMessage: (message: string) => messages.push(message),
                showErrorMessage: (message: string) => messages.push(message)
            } };
        }
    });
    const context = { subscriptions: [], secrets };
    exports.registerJevConnection(context);
    assert.equal(commands.size, 2);
    const connect = commands.get("predictiveDebugger.connectJev");
    const disconnect = commands.get("predictiveDebugger.disconnectJev");
    assert.ok(connect && disconnect);
    assert.equal(await exports.connectedJev(secrets), undefined);
    await connect();
    assert.equal(stored.size, 1);
    assert.equal(typeof await exports.connectedJev(secrets), "function");
    value = undefined;
    await connect();
    assert.equal(stored.size, 1);
    workspace.isTrusted = false;
    assert.equal(await exports.connectedJev(secrets), undefined);
    await connect();
    assert.equal(prompts, 2);
    workspace.isTrusted = true;
    failStorage = true;
    assert.equal(await exports.connectedJev(secrets), undefined);
    failStorage = false;
    await disconnect();
    assert.equal(stored.size, 0);
    assert.equal(await exports.connectedJev(secrets), undefined);
    assert.ok(messages.every(message => !message.includes("test-key")));
});
