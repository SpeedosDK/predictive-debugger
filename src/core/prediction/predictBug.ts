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

/**
 * How much source to send to the model.
 *
 * At roughly 34 bytes per line this covers about 3,500 lines, which is past
 * essentially every hand-written source file. The previous 24,000 truncated at
 * ~700 lines — well inside normal file sizes — and did so silently, so a verdict
 * could be based on a third of the file with no indication. Truncation is now
 * both far rarer and reported.
 *
 * ~120k characters is roughly 30k input tokens. A project scan multiplies that
 * by the number of files, so keep `predictiveDebugger.maxFiles` in mind on
 * expensive models.
 */
const MAX_CODE_CHARS = 120_000;

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

    const { prompt, truncated } = buildPrompt(filePath, code);

    const raw = await provider.complete(location, {
        prompt,
        model,
        signal,
        timeoutMs: timeoutMs ?? 180_000
    });

    const prediction = parsePrediction(raw);
    return truncated ? { ...prediction, truncated } : prediction;
}

/** Describe what was cut, in lines, so the caller can surface it. */
function describeTruncation(code: string): string {
    const totalLines = countLines(code);
    const sentLines = countLines(code.slice(0, MAX_CODE_CHARS));
    return `verdict covers the first ${sentLines} of ${totalLines} lines; the rest was not sent to the model`;
}

function countLines(text: string): number {
    let lines = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) lines++;
    }
    return lines;
}

function buildPrompt(
    filePath: string,
    code: string
): { prompt: string; truncated?: string } {
    const isTruncated = code.length > MAX_CODE_CHARS;
    const body = isTruncated
        ? `${code.slice(0, MAX_CODE_CHARS)}\n/* … file truncated here … */`
        : code;

    const catalogue = BUG_PATTERNS.map((p) => `- ${p.id}: ${p.summary}`).join("\n");

    const prompt = [
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
        body,
        "```"
    ].join("\n");

    return isTruncated ? { prompt, truncated: describeTruncation(code) } : { prompt };
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
