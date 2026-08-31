export type ProviderId = "claude" | "codex" | "copilot";

export interface CliLocation {
    /** Absolute path to the executable / shim we resolved. */
    file: string;
    /** Version string reported by the CLI, if we managed to read one. */
    version?: string;
}

export interface CliAuthState {
    /**
     * Whether the CLI has credentials on disk. This is a cheap filesystem hint,
     * not proof — the only way to know for sure is to run a prompt.
     */
    hasCredentials: boolean;
    /** Where the credentials were found, for display in the connect UI. */
    credentialsPath?: string;
}

export interface CompleteOptions {
    /** The user/task prompt. Always sent over stdin, never as an argv value. */
    prompt: string;
    /** Optional model override (CLI-specific alias, e.g. "claude-haiku-4-5"). */
    model?: string;
    /** Working directory for the CLI process. */
    cwd?: string;
    /** Hard timeout. Defaults to 120s. */
    timeoutMs?: number;
    /** Cancellation, e.g. from a vscode.CancellationToken. */
    signal?: AbortSignal;
}

export interface CliProvider {
    readonly id: ProviderId;
    /** Human-readable name shown in the picker. */
    readonly label: string;
    /** What to tell the user when the CLI is missing. */
    readonly installHint: string;

    /** Resolve the executable, or undefined if the CLI is not installed. */
    locate(): Promise<CliLocation | undefined>;

    /** Cheap on-disk credential check. Never reads secret values. */
    checkAuth(): CliAuthState;

    /** Run a single non-interactive prompt and return the final assistant text. */
    complete(location: CliLocation, options: CompleteOptions): Promise<string>;
}

export class CliError extends Error {
    constructor(
        message: string,
        readonly providerId: ProviderId,
        readonly stderr?: string
    ) {
        super(message);
        this.name = "CliError";
    }
}
