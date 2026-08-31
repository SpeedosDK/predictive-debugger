import { ClaudeCliProvider } from "./claudeCli";
import { CodexCliProvider } from "./codexCli";
import { CopilotCliProvider } from "./copilotCli";
import { CliAuthState, CliLocation, CliProvider, ProviderId } from "./types";

const SELECTED_PROVIDER_KEY = "predictiveDebugger.provider";

/**
 * Minimal persistence contract. `vscode.Memento` satisfies this structurally,
 * so the extension can pass its globalState straight in, while the MCP server
 * uses an in-memory store.
 */
export interface StateStore {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void> | Thenable<void>;
}

export class MemoryStateStore implements StateStore {
    private readonly values = new Map<string, unknown>();

    get<T>(key: string): T | undefined {
        return this.values.get(key) as T | undefined;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }
}

export interface DetectedProvider {
    provider: CliProvider;
    location?: CliLocation;
    auth: CliAuthState;
}

export interface ActiveProvider {
    provider: CliProvider;
    location: CliLocation;
}

export class NoProviderError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NoProviderError";
    }
}

export class ProviderRegistry {
    private readonly providers: CliProvider[] = [
        new ClaudeCliProvider(),
        new CodexCliProvider(),
        new CopilotCliProvider()
    ];

    constructor(private readonly state: StateStore = new MemoryStateStore()) {}

    all(): readonly CliProvider[] {
        return this.providers;
    }

    get(id: ProviderId): CliProvider | undefined {
        return this.providers.find((p) => p.id === id);
    }

    getSelectedId(): ProviderId | undefined {
        return this.state.get<ProviderId>(SELECTED_PROVIDER_KEY);
    }

    async setSelectedId(id: ProviderId | undefined): Promise<void> {
        await this.state.update(SELECTED_PROVIDER_KEY, id);
    }

    /** Probe every provider for installation and on-disk credentials. */
    async detectAll(): Promise<DetectedProvider[]> {
        return Promise.all(
            this.providers.map(async (provider) => ({
                provider,
                location: await provider.locate(),
                auth: provider.checkAuth()
            }))
        );
    }

    /**
     * Resolve the provider to use for a prediction: the explicitly selected one
     * when it is still installed, otherwise the first installed one, so things
     * keep working if a CLI is uninstalled.
     */
    async resolveActive(preferred?: ProviderId): Promise<ActiveProvider> {
        for (const id of [preferred, this.getSelectedId()]) {
            if (!id) continue;
            const provider = this.get(id);
            const location = await provider?.locate();
            if (provider && location) {
                return { provider, location };
            }
        }

        for (const provider of this.providers) {
            const location = await provider.locate();
            if (location) {
                return { provider, location };
            }
        }

        throw new NoProviderError(
            "No supported CLI found. Install the Claude Code CLI, the Codex CLI, or the " +
                "GitHub Copilot CLI, sign in there, then run “Predictive Debugger: Connect”."
        );
    }
}
