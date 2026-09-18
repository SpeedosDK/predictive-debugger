import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createJevReviewer } from "../core/prediction/jev";
import { predictFile } from "../core/prediction/predictFile";
import { predictFiles } from "../core/prediction/predictFiles";
import { BugAssessment } from "../core/types";
import { CliProvider } from "../providers/types";

const assessment: BugAssessment = { findings: [
    { pattern: "null-reference", line: 1, score: 0.95, reason: "Input can be null." },
    { pattern: "logic-error", line: 2, score: 0.8, reason: "The result is discarded." }
] };
const input = { code: "export function f(x) { return x.a; }\nf(null);", callees: [], assessment };
const answer = (score: number) => ({ type: "score", score, confidence: 1,
    probabilities: Object.fromEntries([0, 1, 2, 3, 4].map(level => [String(level), level === score ? 1 : 0])) });
function response() {
    return { model: "jev-1.13.0", answers: {
        evidence_0: answer(4), impact_0: answer(1), evidence_1: answer(3), impact_1: answer(4)
    }, usage: { input_tokens: 200, output_tokens: 20 } };
}

describe("optional Jev review", () => {
    it("sends the documented contract and ranks indices without mutating predictions", async () => {
        const original = structuredClone(assessment);
        let calls = 0;
        const review = createJevReviewer({ apiKey: "test-key", request: async (url, init) => {
            calls++;
            assert.equal(url, "https://api.typesafe.ai/v1/systemone");
            assert.equal(init?.method, "POST");
            assert.equal(init?.redirect, "error");
            assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
            assert.equal(typeof init?.body, "string");
            const body = JSON.parse(String(init?.body));
            assert.equal(body.model, "jev-1.13.0");
            assert.equal(body.questions.evidence_1.type, "score");
            assert.match(body.questions.evidence_1.instructions, /findingIndex 1/);
            assert.equal(body.questions.evidence_1.criteria.length, 5);
            assert.equal(body.state.findings[0].score, undefined);
            assert.match(body.state.source, /1\| export function/);
            assert.ok(!String(init?.body).includes("test-key"));
            return Response.json(response());
        } });
        const result = await review(input);
        assert.equal(calls, 1);
        assert.equal(result.status, "scored");
        if (result.status !== "scored") return;
        assert.deepEqual(result.findings.map(f => f.findingIndex), [1, 0]);
        assert.equal(result.findings[0].evidence.score, 0.75);
        assert.equal(result.findings[0].priority, 0.75);
        assert.deepEqual(result.usage, { inputTokens: 200, outputTokens: 20 });
        assert.deepEqual(assessment, original);
    });

    it("makes no request for absent/invalid credentials, clean findings or excluded source", async () => {
        const request: typeof fetch = async () => { throw new Error("must not call"); };
        assert.deepEqual(await createJevReviewer({ request })(input), { status: "unavailable", reason: "not-configured" });
        assert.deepEqual(await createJevReviewer({ request, apiKey: "bad\nkey" })(input), { status: "unavailable", reason: "invalid-key" });
        const review = createJevReviewer({ request, apiKey: "key" });
        for (const pattern of ["none", "unknown"]) {
            assert.deepEqual(await review({ ...input, assessment: { findings: [{ pattern, score: 0, reason: "" }] } }),
                { status: "skipped", reason: "no-findings" });
        }
        assert.deepEqual(await review({ ...input, code: "x".repeat(30_000) }), { status: "skipped", reason: "context-limit" });
        assert.deepEqual(await review({ ...input, callees: [{ name: "f", from: "./f", source: "x".repeat(30_000) }] }),
            { status: "skipped", reason: "context-limit" });
    });

    it("keeps fractional rubric scores and rejects a contradictory distribution", async () => {
        const data = response();
        data.answers.evidence_0 = { type: "score", score: 1.6, confidence: 0.6,
            probabilities: { "0": 0.05, "1": 0.3, "2": 0.65, "3": 0, "4": 0 } };
        const review = createJevReviewer({ apiKey: "key", request: async () => Response.json(data) });
        const scored = await review(input);
        assert.equal(scored.status, "scored");
        if (scored.status !== "scored") return;
        assert.equal(scored.findings.find(f => f.findingIndex === 0)?.evidence.score, 0.4);
        data.answers.evidence_0.score = 4;
        assert.deepEqual(await review(input), { status: "unavailable", reason: "invalid-response" });
    });

    for (const [status, reason] of [[401, "authentication"], [403, "authentication"], [429, "rate-limit"],
        [500, "service"], [302, "service"]] as const) {
        it(`retains a safe error category for HTTP ${status} without retries`, async () => {
            let calls = 0;
            const result = await createJevReviewer({ apiKey: "secret", request: async () => {
                calls++;
                return new Response("secret echoed by upstream", { status });
            } })(input);
            assert.deepEqual(result, { status: "unavailable", reason });
            assert.equal(calls, 1);
        });
    }

    it("rejects missing, extra, non-finite, out-of-range or malformed answers", async () => {
        const missing = response();
        const { evidence_0: _ignored, ...missingAnswers } = missing.answers;
        const malformed: unknown[] = [null, { ...missing, answers: missingAnswers },
            { ...missing, model: "unexpected" },
            { ...missing, answers: { ...missing.answers, invented: answer(2) } },
            { ...missing, answers: { ...missing.answers, evidence_0: { ...answer(4), score: 5 } } },
            { ...missing, answers: { ...missing.answers, evidence_0: { ...answer(4), confidence: -1 } } },
            { ...missing, answers: { ...missing.answers, evidence_0: { ...answer(4), score: Infinity } } },
            { ...missing, answers: { ...missing.answers, evidence_0: { ...answer(4), probabilities: {} } } }];
        for (const value of malformed) {
            assert.deepEqual(await createJevReviewer({ apiKey: "key", request: async () => Response.json(value) })(input),
                { status: "unavailable", reason: "invalid-response" });
        }
        for (const text of ["not json", "x".repeat(64_001)]) {
            assert.deepEqual(await createJevReviewer({ apiKey: "key", request: async () => new Response(text) })(input),
                { status: "unavailable", reason: "invalid-response" });
        }
    });

    it("sanitizes network errors, including redirect failures", async () => {
        const result = await createJevReviewer({ apiKey: "secret", request: async () => {
            throw new Error("secret and request body");
        } })(input);
        assert.deepEqual(result, { status: "unavailable", reason: "network" });
    });

    it("times out while streaming and honors caller cancellation", async () => {
        const request: typeof fetch = async (_url, init) => new Response(new ReadableStream({
            start(controller) {
                init?.signal?.addEventListener("abort", () => controller.error(new Error("secret")), { once: true });
            }
        }));
        const keepAlive = setTimeout(() => {}, 1000);
        try {
            assert.deepEqual(await createJevReviewer({ apiKey: "key", timeoutMs: 15, request })(input),
                { status: "unavailable", reason: "timeout" });
            const controller = new AbortController();
            const pending = createJevReviewer({ apiKey: "key", request })({ ...input, signal: controller.signal });
            setTimeout(() => controller.abort(), 15);
            assert.deepEqual(await pending, { status: "unavailable", reason: "cancelled" });
            let called = false;
            await createJevReviewer({ apiKey: "key", request: async () => { called = true; return Response.json(response()); } })({ ...input, signal: controller.signal });
            assert.equal(called, false);
        } finally { clearTimeout(keepAlive); }
    });

    it("preserves actual pipeline results in default, scored and unavailable batches", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jev-pipeline-"));
        const provider: CliProvider = {
            id: "claude", label: "fixture", installHint: "", locate: async () => undefined,
            checkAuth: () => ({ hasCredentials: true }), complete: async () => JSON.stringify(assessment)
        };
        try {
            const file = path.join(dir, "example.js");
            await fs.writeFile(file, input.code);
            const options = { provider, location: { file: "fixture" }, multi: true, calleeContext: false };
            const baseline = await predictFile(file, options);
            assert.equal(Object.hasOwn(baseline, "jev"), false);
            const scored = await predictFile(file, { ...options,
                jev: createJevReviewer({ apiKey: "key", request: async () => Response.json(response()) }) });
            const { jev, ...original } = scored;
            assert.equal(jev?.status, "scored");
            assert.deepEqual(original, baseline);
            const batch = await predictFiles([file, file], { ...options, jev: createJevReviewer({}) });
            assert.equal(batch.failures.length, 0);
            assert.equal(batch.results.length, 2);
            assert.ok(batch.results.every(result => result.jev?.status === "unavailable"));
            assert.deepEqual(batch.results[0].ai, baseline.ai);
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
});
