import fs from "fs";
import os from "os";
import path from "path";
import { hasNonEmptyFile, which } from "./locate";
import { runProcess } from "./processRunner";
import {
    CliAuthState,
    CliError,
    CliLocation,
    CliProvider,
    CompleteOptions
} from "./types";

/**
 * Codex CLI provider.
 *
 * `codex exec` runs non-interactively against whatever account the user signed
 * in with (`codex login`). We read the final assistant message from a temp file
 * rather than parsing the JSONL event stream, whose shape varies by version.
 */
export class CodexCliProvider implements CliProvider {
    readonly id = "codex" as const;
    readonly label = "Codex CLI";
    readonly installHint =
        "Install with `npm i -g @openai/codex`, then run `codex login` to sign in.";

    private cached?: CliLocation;

    async locate(): Promise<CliLocation | undefined> {
        if (this.cached) {
            return this.cached;
        }

        const file = which("codex");
        if (!file) {
            return undefined;
        }

        let version: string | undefined;
        try {
            const result = await runProcess({ file, args: ["--version"], timeoutMs: 20_000 });
            // e.g. "codex-cli 0.147.0"
            const match = result.stdout.trim().match(/(\d+\.\d+\.\d+\S*)/);
            version = match?.[1];
        } catch {
            // Non-fatal — the CLI may still run prompts.
        }

        this.cached = { file, version };
        return this.cached;
    }

    checkAuth(): CliAuthState {
        const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
        const authPath = path.join(codexHome, "auth.json");

        if (hasNonEmptyFile(authPath)) {
            return { hasCredentials: true, credentialsPath: authPath };
        }
        if (process.env.OPENAI_API_KEY) {
            return { hasCredentials: true, credentialsPath: "OPENAI_API_KEY" };
        }
        return { hasCredentials: false };
    }

    async complete(location: CliLocation, options: CompleteOptions): Promise<string> {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "predictive-debugger-"));
        const messagePath = path.join(tempDir, "last-message.txt");

        const args = [
            "exec",
            // Read the prompt from stdin.
            "-",
            "--skip-git-repo-check",
            // Don't leave session files behind for a one-shot classification.
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "--output-last-message",
            messagePath
        ];
        if (options.model) {
            args.push("--model", options.model);
        }

        try {
            const result = await runProcess({
                file: location.file,
                args,
                input: options.prompt,
                cwd: options.cwd,
                timeoutMs: options.timeoutMs,
                signal: options.signal
            });

            const message = readIfPresent(messagePath);

            if (result.code !== 0 || message === undefined) {
                throw new CliError(
                    `Codex CLI exited with code ${result.code ?? "unknown"}.`,
                    this.id,
                    (result.stderr.trim() || result.stdout.trim()) || undefined
                );
            }

            return message;
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
}

function readIfPresent(file: string): string | undefined {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return undefined;
    }
}
