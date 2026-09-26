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

        const args = execArgs(messagePath, options.model);

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

/**
 * Agent features a review never needs. Enabled by default, they give a model reading
 * untrusted source a shell (read-only sandbox, so it can still read any file), a
 * browser, computer use, plugins and sub-agents. The `-c` form is used because
 * `--disable` rejects names a CLI version does not know, which would turn a future
 * rename into a failed review; unknown `-c` feature keys are ignored.
 *
 * Measured on CLI 0.157.1: per-call context 17.8k -> 14.0k tokens, but none of it is
 * served from Codex's shared prompt cache any more (+~9k uncached tokens per call).
 */
const DISABLED_FEATURES = [
    "shell_tool", "unified_exec", "browser_use", "browser_use_external", "browser_use_full_cdp_access",
    "computer_use", "in_app_browser", "apps", "plugins", "multi_agent", "image_generation",
    "skill_search", "tool_suggest", "view_image", "goals", "sleep_tool", "code_mode_host", "collaboration_modes"
];

export function execArgs(messagePath: string, model?: string): string[] {
    return [
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
        ...DISABLED_FEATURES.flatMap(feature => ["-c", `features.${feature}=false`]),
        "--output-last-message",
        messagePath,
        ...(model ? ["--model", model] : [])
    ];
}
