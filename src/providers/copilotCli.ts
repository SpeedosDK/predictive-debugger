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

/** Checked in this order by `copilot` itself. */
const AUTH_ENV_VARS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;

/**
 * GitHub Copilot CLI provider.
 *
 * The prompt is piped in on stdin rather than passed as `copilot -p <text>`:
 * our prompts carry up to 120 KB of source, which exceeds the command line
 * limit on every platform. A piped prompt runs the same non-interactive turn,
 * but only while `-p` is absent — piped input is ignored whenever `-p` is
 * given. Credentials stay with the CLI; the extension never sees a token.
 */
export class CopilotCliProvider implements CliProvider {
    readonly id = "copilot" as const;
    readonly label = "GitHub Copilot CLI";
    readonly installHint =
        "Install with `npm i -g @github/copilot`, then run `copilot` and use `/login` to sign in.";

    private cached?: CliLocation;

    async locate(): Promise<CliLocation | undefined> {
        if (this.cached) {
            return this.cached;
        }

        const file = which("copilot");
        if (!file) {
            return undefined;
        }

        let version: string | undefined;
        try {
            const result = await runProcess({ file, args: ["--version"], timeoutMs: 20_000 });
            version = parseVersion(result.stdout);
        } catch {
            // Non-fatal — the CLI may still run prompts.
        }

        this.cached = { file, version };
        return this.cached;
    }

    checkAuth(): CliAuthState {
        for (const name of AUTH_ENV_VARS) {
            if (process.env[name]) {
                return { hasCredentials: true, credentialsPath: name };
            }
        }

        // `copilot login` also accepts the OAuth token the gh CLI stores.
        const hostsFile = ghHostsFile();
        if (hasNonEmptyFile(hostsFile)) {
            return { hasCredentials: true, credentialsPath: hostsFile };
        }

        // `/login` puts the token in the system credential store, which we
        // deliberately do not read, and only falls back to a plain-text file
        // under COPILOT_HOME when no store is available. So a config directory
        // the CLI has already written is the most we can see from here; the
        // live prompt in the connect flow is what actually settles it.
        if (fs.existsSync(copilotHome())) {
            return { hasCredentials: true, credentialsPath: "system credential store" };
        }
        return { hasCredentials: false };
    }

    async complete(location: CliLocation, options: CompleteOptions): Promise<string> {
        const result = await runProcess({
            file: location.file,
            args: completeArgs(options.model),
            input: options.prompt,
            cwd: options.cwd,
            timeoutMs: options.timeoutMs,
            signal: options.signal
        });

        if (result.code !== 0) {
            throw new CliError(
                describeFailure(result.stderr, result.code),
                this.id,
                result.stderr.trim() || undefined
            );
        }

        if (!result.stdout.trim()) {
            throw new CliError(
                "GitHub Copilot CLI returned no output.",
                this.id,
                result.stderr.trim() || undefined
            );
        }

        return result.stdout;
    }
}

/**
 * Arguments for one non-interactive turn. The prompt is not among them: it
 * arrives on stdin, which keeps the command line short enough for the `.cmd`
 * shim npm installs on Windows.
 */
export function completeArgs(model?: string): string[] {
    const args = [
        // Print the reply and nothing else: no banner, no session stats.
        "--silent",
        "--no-color",
        // A one-shot classification has nothing worth logging, and an update
        // downloaded mid-prediction would only add latency.
        "--log-level",
        "none",
        "--no-auto-update",
        // Text in, text out. Denials beat every allow rule, including a future
        // `--allow-all-tools`, and the source we send is untrusted input.
        "--deny-tool=shell,write,url",
        "--disable-builtin-mcps",
        // Nobody is there to answer a question in this mode.
        "--no-ask-user"
    ];
    if (model) {
        args.push("--model", model);
    }
    return args;
}

/** First semver-looking token in `copilot --version` ("GitHub Copilot CLI 1.0.82."). */
export function parseVersion(stdout: string): string | undefined {
    return stdout.match(/(\d+\.\d+\.\d+(?:[-+][\w.]*\w)?)/)?.[1];
}

function copilotHome(): string {
    return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
}

function ghHostsFile(): string {
    if (process.env.GH_CONFIG_DIR) {
        return path.join(process.env.GH_CONFIG_DIR, "hosts.yml");
    }
    if (process.platform === "win32" && process.env.APPDATA) {
        return path.join(process.env.APPDATA, "GitHub CLI", "hosts.yml");
    }
    const configHome =
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(configHome, "gh", "hosts.yml");
}

function describeFailure(stderr: string, code: number | null): string {
    // The CLI reports a missing or rejected sign-in on stderr and exits 1.
    if (/authentic|token|login|credential/i.test(stderr)) {
        return "GitHub Copilot CLI is not signed in. Run `copilot` and use `/login`.";
    }
    return `GitHub Copilot CLI exited with code ${code ?? "unknown"}.`;
}
