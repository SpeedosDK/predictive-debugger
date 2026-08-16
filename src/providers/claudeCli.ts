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

interface ClaudePrintResult {
    type?: string;
    subtype?: string;
    is_error?: boolean;
    result?: string;
    // Present when the CLI fails before producing a result.
    error?: unknown;
}

/**
 * Claude Code CLI provider.
 *
 * We shell out to `claude --print`, which reuses whatever credentials the user
 * already logged in with (`claude login`, or ANTHROPIC_API_KEY). The extension
 * never sees, stores, or transmits a token.
 */
export class ClaudeCliProvider implements CliProvider {
    readonly id = "claude" as const;
    readonly label = "Claude Code CLI";
    readonly installHint =
        "Install with `npm i -g @anthropic-ai/claude-code`, then run `claude` once to sign in.";

    private cached?: CliLocation;

    async locate(): Promise<CliLocation | undefined> {
        if (this.cached) {
            return this.cached;
        }

        const file = which("claude");
        if (!file) {
            return undefined;
        }

        let version: string | undefined;
        try {
            const result = await runProcess({ file, args: ["--version"], timeoutMs: 20_000 });
            // e.g. "2.1.232 (Claude Code)"
            version = result.stdout.trim().split(/\s+/)[0] || undefined;
        } catch {
            // A CLI that can't report its version may still work; don't fail here.
        }

        this.cached = { file, version };
        return this.cached;
    }

    checkAuth(): CliAuthState {
        const credentialsPath = path.join(os.homedir(), ".claude", ".credentials.json");

        if (hasNonEmptyFile(credentialsPath)) {
            return { hasCredentials: true, credentialsPath };
        }
        if (process.env.ANTHROPIC_API_KEY) {
            return { hasCredentials: true, credentialsPath: "ANTHROPIC_API_KEY" };
        }
        if (process.platform === "darwin") {
            // Claude Code stores credentials in the macOS Keychain, which we
            // deliberately do not read. Assume present and let verification decide.
            return { hasCredentials: true, credentialsPath: "macOS Keychain" };
        }
        return { hasCredentials: false };
    }

    async complete(location: CliLocation, options: CompleteOptions): Promise<string> {
        const args = [
            "--print",
            "--output-format",
            "json",
            // Pure text in, text out: no file reads, no bash, no web access.
            "--tools",
            ""
        ];
        if (options.model) {
            args.push("--model", options.model);
        }

        const result = await runProcess({
            file: location.file,
            args,
            input: options.prompt,
            cwd: options.cwd,
            timeoutMs: options.timeoutMs,
            signal: options.signal
        });

        const parsed = parsePrintResult(result.stdout);

        if (result.code !== 0 || !parsed || parsed.is_error) {
            throw new CliError(
                describeFailure(parsed, result.code),
                this.id,
                result.stderr.trim() || undefined
            );
        }

        if (typeof parsed.result !== "string") {
            throw new CliError(
                "Claude CLI returned no result text.",
                this.id,
                result.stderr.trim() || undefined
            );
        }

        return parsed.result;
    }
}

function parsePrintResult(stdout: string): ClaudePrintResult | undefined {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return undefined;
    }

    try {
        return JSON.parse(trimmed) as ClaudePrintResult;
    } catch {
        // Tolerate leading diagnostics: take the last line that parses as JSON.
        const lines = trimmed.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                return JSON.parse(lines[i]) as ClaudePrintResult;
            } catch {
                continue;
            }
        }
        return undefined;
    }
}

function describeFailure(
    parsed: ClaudePrintResult | undefined,
    code: number | null
): string {
    if (parsed?.subtype && parsed.subtype !== "success") {
        return `Claude CLI failed (${parsed.subtype}).`;
    }
    if (typeof parsed?.result === "string" && parsed.result.trim()) {
        return `Claude CLI failed: ${parsed.result.trim()}`;
    }
    return `Claude CLI exited with code ${code ?? "unknown"}.`;
}
