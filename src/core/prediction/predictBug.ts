import { CliProvider, CliLocation } from "../../providers/types";
import { BugPrediction } from "../types";

/** Mirrors the example files in `examples/bug-patterns/`. */
const BUG_PATTERNS = [
    { id: "race_condition", summary: "shared state mutated across an await or callback boundary" },
    { id: "null_reference", summary: "a value that can be null/undefined is dereferenced" },
    { id: "off_by_one", summary: "loop or index bounds are off by one" },
    { id: "async_misuse", summary: "a promise is not awaited, or errors escape unhandled" },
    { id: "resource_leak", summary: "a handle, listener, or timer is never released" },
    { id: "unhandled_error", summary: "a failure path has no handling and will surface as a crash" }
] as const;

const MAX_CODE_CHARS = 24_000;

export interface PredictBugOptions {
    provider: CliProvider;
    location: CliLocation;
    filePath: string;
    code: string;
    model?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

/**
 * Ask the signed-in CLI to classify the most likely runtime failure in a file.
 *
 * This replaces the previous embedding-similarity approach: the CLIs expose a
 * chat interface, not an embeddings endpoint, so the pattern match happens in
 * the model rather than in cosine distance.
 */
export async function predictBug(options: PredictBugOptions): Promise<BugPrediction> {
    const { provider, location, filePath, code, model, signal, timeoutMs } = options;

    const raw = await provider.complete(location, {
        prompt: buildPrompt(filePath, code),
        model,
        signal,
        timeoutMs: timeoutMs ?? 180_000
    });

    return parsePrediction(raw);
}

function buildPrompt(filePath: string, code: string): string {
    const truncated =
        code.length > MAX_CODE_CHARS
            ? `${code.slice(0, MAX_CODE_CHARS)}\n/* … truncated … */`
            : code;

    const catalogue = BUG_PATTERNS.map((p) => `- ${p.id}: ${p.summary}`).join("\n");

    return [
        "You are a static analysis engine. Judge only the source you are given;",
        "do not read files, run commands, or search the web.",
        "",
        "Identify the single most likely runtime failure in the file below.",
        "",
        "Known bug patterns:",
        catalogue,
        "",
        "Respond with one JSON object and nothing else — no prose, no code fences:",
        '{"pattern": "<pattern id, or \\"none\\">", "score": <0.0-1.0 likelihood this file fails at runtime>, "line": <1-based line number, or null>, "reason": "<one sentence>"}',
        "",
        `File: ${filePath}`,
        "```",
        truncated,
        "```"
    ].join("\n");
}

/** Pull the JSON verdict out of a model reply that may include stray prose. */
export function parsePrediction(raw: string): BugPrediction {
    const json = extractJsonObject(raw);

    if (!json) {
        return {
            pattern: "unknown",
            score: 0,
            reason: `Could not parse a verdict from the model reply: ${firstLine(raw)}`
        };
    }

    const pattern =
        typeof json.pattern === "string" && json.pattern.trim()
            ? json.pattern.trim()
            : "none";

    const score = clamp01(Number(json.score));
    const line =
        typeof json.line === "number" && Number.isFinite(json.line) && json.line > 0
            ? Math.floor(json.line)
            : undefined;

    return {
        pattern,
        score: pattern === "none" ? 0 : score,
        reason: typeof json.reason === "string" ? json.reason.trim() : "",
        line
    };
}

function extractJsonObject(raw: string): Record<string, unknown> | undefined {
    const withoutFences = raw.replace(/```(?:json)?/gi, "");
    const start = withoutFences.indexOf("{");
    const end = withoutFences.lastIndexOf("}");

    if (start === -1 || end <= start) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(withoutFences.slice(start, end + 1));
        return typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

function firstLine(text: string): string {
    const line = text.split(/\r?\n/).find((l) => l.trim());
    return line ? line.trim().slice(0, 200) : "(empty)";
}
