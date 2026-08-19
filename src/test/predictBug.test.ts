import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePrediction, predictBug } from "../core/prediction/predictBug";

describe("parsePrediction", () => {
    it("parses a clean JSON verdict", () => {
        const result = parsePrediction(
            '{"pattern":"off_by_one","score":0.9,"line":3,"reason":"loop runs one too far"}'
        );
        assert.equal(result.pattern, "off_by_one");
        assert.equal(result.score, 0.9);
        assert.equal(result.line, 3);
        assert.equal(result.reason, "loop runs one too far");
    });

    it("strips code fences", () => {
        const result = parsePrediction(
            '```json\n{"pattern":"null_reference","score":0.5,"reason":"x"}\n```'
        );
        assert.equal(result.pattern, "null_reference");
    });

    it("ignores prose around the object", () => {
        const result = parsePrediction(
            'Here is my analysis:\n{"pattern":"race_condition","score":0.7,"reason":"y"}\nHope that helps!'
        );
        assert.equal(result.pattern, "race_condition");
        assert.equal(result.score, 0.7);
    });

    it("forces score to 0 when the pattern is none", () => {
        const result = parsePrediction('{"pattern":"none","score":0.8,"reason":"looks fine"}');
        assert.equal(result.score, 0);
    });

    it("clamps out-of-range scores", () => {
        assert.equal(parsePrediction('{"pattern":"x","score":5}').score, 1);
        assert.equal(parsePrediction('{"pattern":"x","score":-2}').score, 0);
        assert.equal(parsePrediction('{"pattern":"x","score":"abc"}').score, 0);
    });

    it("drops a non-positive or missing line number", () => {
        assert.equal(parsePrediction('{"pattern":"x","score":0.5,"line":0}').line, undefined);
        assert.equal(parsePrediction('{"pattern":"x","score":0.5,"line":null}').line, undefined);
        assert.equal(parsePrediction('{"pattern":"x","score":0.5}').line, undefined);
    });

    it("floors a fractional line number", () => {
        assert.equal(parsePrediction('{"pattern":"x","score":0.5,"line":7.8}').line, 7);
    });

    it("degrades to an unknown verdict on unparseable output", () => {
        const result = parsePrediction("I could not analyse that file.");
        assert.equal(result.pattern, "unknown");
        assert.equal(result.score, 0);
        assert.match(result.reason, /Could not parse/);
    });

    it("degrades to an unknown verdict on malformed JSON", () => {
        const result = parsePrediction('{"pattern": "x", "score":');
        assert.equal(result.pattern, "unknown");
    });

    it("treats an empty pattern as none", () => {
        assert.equal(parsePrediction('{"pattern":"   ","score":0.9}').pattern, "none");
    });
});

describe("parsePrediction — bounding untrusted model output", () => {
    it("clips an overlong reason", () => {
        const long = "x".repeat(5000);
        const result = parsePrediction(
            JSON.stringify({ pattern: "off_by_one", score: 0.5, reason: long })
        );
        assert.ok(result.reason.length <= 401, `reason was ${result.reason.length} chars`);
        assert.ok(result.reason.endsWith("…"));
    });

    it("clips an overlong pattern id", () => {
        const result = parsePrediction(
            JSON.stringify({ pattern: "y".repeat(500), score: 0.5, reason: "r" })
        );
        assert.ok(result.pattern.length <= 65);
    });

    it("leaves normal-length fields untouched", () => {
        const result = parsePrediction(
            '{"pattern":"race_condition","score":0.5,"reason":"short reason"}'
        );
        assert.equal(result.reason, "short reason");
        assert.equal(result.pattern, "race_condition");
    });
});

describe("buildPrompt truncation reporting", () => {
    it("does not flag a normal-sized file", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        const result = await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "small.js",
            code: "const x = 1;\n"
        });
        assert.equal(result.truncated, undefined);
        assert.ok(fake.lastPrompt.includes("const x = 1;"));
    });

    it("asks for locally demonstrated defects rather than speculative failures", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "service.js",
            code: "async function load(repo) { return await repo.get(); }\n"
        });

        assert.ok(fake.lastPrompt.includes("Precision is more"));
        assert.ok(fake.lastPrompt.includes("observably wrong return value"));
        assert.ok(fake.lastPrompt.includes("awaited rejection propagating to the caller"));
        assert.ok(fake.lastPrompt.includes(">= 0.70"));
    });

    it("treats concurrency as a normal execution, not an invented input", async () => {
        // Without this the policy suppresses race conditions: asked to disprove
        // the claim first, a model reading one sequential pass through the file
        // always can. It cost the benchmark every trial on the planted race.
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "worker.js",
            code: "async function tick(ledger) { const b = await ledger.read(); await ledger.write(b + 1); }"
        });

        assert.ok(fake.lastPrompt.includes("Concurrency is a normal execution"));
        assert.ok(fake.lastPrompt.includes("entered again before an earlier call finishes"));
        // The exemption matters as much as the rule: a local accumulator inside
        // one invocation must not start reading as shared state.
        assert.ok(fake.lastPrompt.includes("a local variable"));
    });

    it("reports how much of an oversized file was analysed", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        // 200k chars of 10-char lines = 20,000 lines, past the 120k cap.
        const code = "let a = 1;\n".repeat(20_000);
        const result = await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "big.js",
            code
        });
        assert.match(result.truncated ?? "", /covers the first \d+ of 20001 lines/);
        assert.ok(fake.lastPrompt.includes("file truncated here"));
        // The prompt must stay bounded even for a huge input.
        assert.ok(fake.lastPrompt.length < 130_000, `prompt was ${fake.lastPrompt.length}`);
    });
});

function fakeProvider(reply: string) {
    const state = { lastPrompt: "" };
    return {
        get lastPrompt() {
            return state.lastPrompt;
        },
        provider: {
            id: "claude" as const,
            label: "fake",
            installHint: "",
            locate: async () => ({ file: "fake" }),
            checkAuth: () => ({ hasCredentials: true }),
            complete: async (_loc: unknown, opts: { prompt: string }) => {
                state.lastPrompt = opts.prompt;
                return reply;
            }
        }
    };
}
