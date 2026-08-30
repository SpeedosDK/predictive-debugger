import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAssessment, parsePrediction, predictBug } from "../core/prediction/predictBug";

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

    it("recovers a verdict from a reply that was cut off mid-key", () => {
        // Observed once in 36 benchmark runs: a complete, correct verdict
        // followed by the start of another key, and nothing else. Discarding it
        // scored as a missed defect, which is the most expensive way to be wrong.
        const result = parsePrediction(
            '{"pattern":"null_reference","score":0.72,"line":6,"reason":"row.discount has no default","line_ch'
        );
        assert.equal(result.pattern, "null_reference");
        assert.equal(result.score, 0.72);
        assert.equal(result.line, 6);
        assert.equal(result.reason, "row.discount has no default");
    });

    it("does not invent a verdict from a reply cut off before any pair completed", () => {
        const result = parsePrediction('{"pattern":"null_refer');
        assert.equal(result.pattern, "unknown");
        assert.equal(result.score, 0);
    });

    it("is not confused by a brace inside a string", () => {
        const result = parsePrediction(
            '{"pattern":"other","score":0.5,"reason":"the literal {} is empty","line":4}'
        );
        assert.equal(result.pattern, "other");
        assert.equal(result.reason, "the literal {} is empty");
        assert.equal(result.line, 4);
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

describe("parseAssessment — the coverage self-report", () => {
    // Nothing else in the reply separates "checked for this and found nothing"
    // from "never considered it": pattern "none" with score 0 looks identical
    // either way. See issue #12.
    it("keeps the catalogue ids the model says it considered", () => {
        const result = parseAssessment(
            '{"pattern":"none","score":0,"reason":"clean","checked":["race_condition","off_by_one"]}'
        );
        assert.deepEqual(result.checked, ["race_condition", "off_by_one"]);
    });

    it("reports them in catalogue order, so two replies compare directly", () => {
        const result = parseAssessment(
            '{"pattern":"none","score":0,"checked":["other","off_by_one","race_condition"]}'
        );
        assert.deepEqual(result.checked, ["race_condition", "off_by_one", "other"]);
    });

    it("drops ids that are not in the catalogue", () => {
        // Which also bounds the field without a length cap: the model cannot
        // return more entries than the catalogue has.
        const result = parseAssessment(
            '{"pattern":"none","score":0,"checked":["race_condition","sql_injection","","none"]}'
        );
        assert.deepEqual(result.checked, ["race_condition"]);
    });

    it("de-duplicates a repeated id", () => {
        const result = parseAssessment(
            '{"pattern":"none","score":0,"checked":["null_reference","null_reference"]}'
        );
        assert.deepEqual(result.checked, ["null_reference"]);
    });

    it("leaves it undefined when the model reported nothing", () => {
        // Distinct from an empty list, which would claim the model said it
        // checked nothing.
        assert.equal(parseAssessment('{"pattern":"none","score":0}').checked, undefined);
        assert.equal(parseAssessment('{"pattern":"none","score":0,"checked":[]}').checked, undefined);
        assert.equal(
            parseAssessment('{"pattern":"none","score":0,"checked":"race_condition"}').checked,
            undefined
        );
    });

    it("keeps the reported pattern alongside the rest of the coverage", () => {
        const result = parseAssessment(
            '{"pattern":"race_condition","score":0.8,"checked":["race_condition","resource_leak"]}'
        );
        assert.equal(result.findings[0].pattern, "race_condition");
        assert.deepEqual(result.checked, ["race_condition", "resource_leak"]);
    });

    it("keeps the verdict, and the coverage that did arrive, from a cut-off reply", () => {
        // `checked` is last in the response schema precisely so truncation
        // costs the disclosure before it costs the verdict. The repair cuts
        // back to the last value boundary at any depth, so the ids that made it
        // through are kept -- the model did report weighing them, and the
        // partial one it did not finish naming is dropped rather than guessed.
        const result = parseAssessment(
            '{"pattern":"off_by_one","score":0.8,"line":4,"reason":"loop runs one too far","checked":["off_by_one","race_cond'
        );
        assert.equal(result.findings[0].pattern, "off_by_one");
        assert.equal(result.findings[0].line, 4);
        assert.deepEqual(result.checked, ["off_by_one"]);
    });

    it("does not confuse an absent coverage report with an unavailable verdict", () => {
        const unavailable = parseAssessment("no idea");
        assert.equal(unavailable.findings[0].pattern, "unknown");
        assert.equal(unavailable.checked, undefined);
    });
});

describe("buildPrompt — asking for coverage", () => {
    it("asks which categories were considered, not only which was found", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: "const x = 1;"
        });

        assert.ok(fake.lastPrompt.includes('"checked" is a coverage record'));
        assert.ok(fake.lastPrompt.includes('"checked": ["<pattern ids you considered>"]'));
        // Padding the list would make the field worse than absent, so the
        // prompt has to say so.
        assert.ok(fake.lastPrompt.includes("Do not pad the list"));
        // It must not read as a lever on the verdict.
        assert.ok(fake.lastPrompt.includes("It does not affect the score"));
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

    it("offers an escape hatch for defects outside the catalogue", async () => {
        // A closed list of six ids threw away correct answers. Asked about a
        // method filtering on createdAt where its own documentation promised
        // updatedAt, the model named the line and explained the contradiction,
        // then had to answer "none" because nothing fitted -- and parsePrediction
        // forces the score to 0 for "none". Five of fifteen buggy runs in the
        // TypeScript corpus were correct findings discarded that way.
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "sync.ts",
            code: "export const f = (rows) => rows.filter((r) => r.createdAt > since);"
        });

        assert.ok(fake.lastPrompt.includes("- other:"));
        assert.ok(fake.lastPrompt.includes('Use "none" only when the source has no defect'));
        assert.ok(fake.lastPrompt.includes("do not answer \"none\" for a defect you can"));
        // The escape hatch must not become a dumping ground. On the JavaScript
        // corpus it started reporting the generator's duplicated methods, which
        // the model itself called "redundant but not itself a runtime failure".
        assert.ok(fake.lastPrompt.includes("It is not for maintainability"));
    });

    it("numbers the source lines it sends", async () => {
        // The model reasons about the defect correctly and then reports a line
        // six to twelve lines away on larger files, because it was counting
        // newlines by eye. Five of eighteen benchmark runs missed that way.
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: ["const a = 1;", "const b = 2;", "const c = 3;", ""].join("\n")
        });

        assert.ok(fake.lastPrompt.includes("1| const a = 1;"));
        assert.ok(fake.lastPrompt.includes("2| const b = 2;"));
        assert.ok(fake.lastPrompt.includes("Report the number shown on the line"));
    });

    it("pads the gutter so it does not shift partway down a file", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: Array.from({ length: 12 }, (_, i) => `let v${i} = ${i};`).join("\n")
        });

        assert.ok(fake.lastPrompt.includes(" 9| let v8 = 8;"));
        assert.ok(fake.lastPrompt.includes("10| let v9 = 9;"));
    });

    it("keeps the score of a finding outside the catalogue", async () => {
        // "none" is forced to 0 on purpose; "other" must not be.
        const prediction = parsePrediction(
            '{"pattern":"other","score":0.8,"line":16,"reason":"filters on the wrong field"}'
        );
        assert.equal(prediction.pattern, "other");
        assert.equal(prediction.score, 0.8);
        assert.equal(prediction.line, 16);
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

    it("sends the definitions of imported functions the file calls", async () => {
        // Single-file scope produced a false positive that was attributable to
        // it entirely: the disproof was that a callee was idempotent, and that
        // callee was one import away. See issue #4.
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "billing.ts",
            code: 'import { normalizeBillingDate } from "./dates";\nexport const f = (r) => normalizeBillingDate(r.due);',
            callees: [
                {
                    name: "normalizeBillingDate",
                    from: "./dates.ts",
                    source: "function normalizeBillingDate(v) { return v instanceof Date ? v : new Date(v); }"
                }
            ]
        });

        assert.ok(fake.lastPrompt.includes("----- BEGIN CALLEE DEFINITIONS -----"));
        assert.ok(fake.lastPrompt.includes("// normalizeBillingDate — from ./dates.ts"));
        assert.ok(fake.lastPrompt.includes("v instanceof Date"));
        assert.ok(fake.lastPrompt.includes("A callee that already"));
    });

    it("says a callee is context, not the subject of the review", async () => {
        // Otherwise the verdict on a file drifts onto a defect in a helper it
        // merely calls, and the reported line number belongs to another file.
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.ts",
            code: 'import { h } from "./h";\nh();',
            callees: [{ name: "h", from: "./h.ts", source: "function h() {}" }]
        });

        assert.ok(fake.lastPrompt.includes("report defects only in the text"));
        assert.ok(fake.lastPrompt.includes("never a defect in a callee"));
        // The asymmetry matters as much as the rule: an unresolved import must
        // not read as evidence against the caller.
        assert.ok(fake.lastPrompt.includes("is not thereby suspect"));
    });

    it("marks a callee whose definition was cut", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.ts",
            code: "big();",
            callees: [{ name: "big", from: "./big.ts", source: "function big() {", excerpted: true }]
        });

        assert.ok(fake.lastPrompt.includes("(definition truncated)"));
    });

    it("omits the callee block entirely when nothing resolved", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: "const x = 1;",
            callees: []
        });

        assert.ok(!fake.lastPrompt.includes("CALLEE DEFINITIONS"));
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

describe("parseAssessment — a ranked list of findings", () => {
    it("parses a bare array of findings", () => {
        const result = parseAssessment(
            '[{"pattern":"off_by_one","score":0.8,"line":3,"reason":"a"},' +
                '{"pattern":"resource_leak","score":0.6,"line":9,"reason":"b"}]'
        );
        assert.deepEqual(
            result.findings.map((f) => f.pattern),
            ["off_by_one", "resource_leak"]
        );
        assert.equal(result.findings[1].line, 9);
    });

    it("parses the findings envelope, with file-level coverage outside the list", () => {
        const result = parseAssessment(
            '{"findings":[{"pattern":"race_condition","score":0.9,"reason":"a"}],' +
                '"checked":["race_condition","null_reference"]}'
        );
        assert.deepEqual(
            result.findings.map((f) => f.pattern),
            ["race_condition"]
        );
        assert.deepEqual(result.checked, ["race_condition", "null_reference"]);
    });

    it("still accepts a single object, whichever shape the prompt asked for", () => {
        // Discarding a correct answer over its container is the one outcome
        // worth ruling out here: a missed defect is the most expensive way for
        // this tool to be wrong.
        const result = parseAssessment('{"pattern":"null_reference","score":0.7,"reason":"a"}');
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].pattern, "null_reference");
    });

    it("ranks by score, highest first", () => {
        const result = parseAssessment(
            '[{"pattern":"off_by_one","score":0.3,"reason":"a"},' +
                '{"pattern":"race_condition","score":0.9,"reason":"b"},' +
                '{"pattern":"resource_leak","score":0.6,"reason":"c"}]'
        );
        assert.deepEqual(
            result.findings.map((f) => f.score),
            [0.9, 0.6, 0.3]
        );
    });

    it("keeps the model's own order for findings it scored the same", () => {
        const result = parseAssessment(
            '[{"pattern":"off_by_one","score":0.8,"reason":"first"},' +
                '{"pattern":"resource_leak","score":0.8,"reason":"second"}]'
        );
        assert.deepEqual(
            result.findings.map((f) => f.reason),
            ["first", "second"]
        );
    });

    it("collapses an empty list to the one none verdict", () => {
        // An empty list is how the multi-finding prompt says "clean", and the
        // rest of the product asks `findings[0]` what the verdict was.
        const result = parseAssessment('{"findings":[],"checked":["race_condition"]}');
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].pattern, "none");
        assert.equal(result.findings[0].score, 0);
        assert.deepEqual(result.checked, ["race_condition"]);
    });

    it("drops a none that arrives alongside a real finding", () => {
        // A reply reporting both is contradicting itself, and the finding is
        // the half that carries information.
        const result = parseAssessment(
            '[{"pattern":"none","score":0,"reason":"clean"},' +
                '{"pattern":"off_by_one","score":0.8,"reason":"a"}]'
        );
        assert.deepEqual(
            result.findings.map((f) => f.pattern),
            ["off_by_one"]
        );
    });

    it("caps the list, because the reply is untrusted output", () => {
        const many = Array.from(
            { length: 30 },
            (_, i) => `{"pattern":"off_by_one","score":0.5,"reason":"r${i}"}`
        ).join(",");
        const result = parseAssessment(`[${many}]`);
        assert.equal(result.findings.length, 10);
    });

    it("ignores non-objects in the list rather than failing the whole reply", () => {
        const result = parseAssessment(
            '[null,"nonsense",{"pattern":"off_by_one","score":0.8,"reason":"a"}]'
        );
        assert.deepEqual(
            result.findings.map((f) => f.pattern),
            ["off_by_one"]
        );
    });

    it("reads a bare empty list as a clean file, the same as an empty envelope", () => {
        const result = parseAssessment("[]");
        assert.equal(result.findings[0].pattern, "none");
        assert.equal(result.findings[0].score, 0);
    });

    it("degrades to unknown when entries arrived but none could be read", () => {
        // The opposite of an empty list: something was said and we could not
        // make it out. Collapsing the two would report a reply we failed to
        // parse as a clean bill of health.
        const result = parseAssessment('[null,"nonsense"]');
        assert.equal(result.findings[0].pattern, "unknown");
        assert.match(result.findings[0].reason, /Could not parse/);
    });

    it("keeps the complete findings from a list cut off inside a later one", () => {
        // The old repair cut at the last top-level comma, so a truncation two
        // levels down discarded findings that had arrived whole.
        const result = parseAssessment(
            '[{"pattern":"off_by_one","score":0.8,"line":3,"reason":"a"},' +
                '{"pattern":"resource_leak","score":0.6,"line":9,"reason":"b"},' +
                '{"pattern":"race_cond'
        );
        assert.deepEqual(
            result.findings.map((f) => f.pattern),
            ["off_by_one", "resource_leak"]
        );
    });

    it("recovers the complete pairs of a finding cut off mid-key", () => {
        const result = parseAssessment(
            '[{"pattern":"off_by_one","score":0.8,"reason":"a"},' +
                '{"pattern":"resource_leak","score":0.6,"line_ch'
        );
        assert.deepEqual(
            result.findings.map((f) => f.pattern),
            ["off_by_one", "resource_leak"]
        );
        assert.equal(result.findings[1].line, undefined);
    });

    it("does not invent a finding from a fragment that completed no pair", () => {
        const result = parseAssessment('[{"pattern":"off_by_one","score":0.8,"reason":"a"},{"pat');
        assert.deepEqual(
            result.findings.map((f) => f.pattern),
            ["off_by_one"]
        );
    });

    it("forces the score of a none inside a list to zero", () => {
        const result = parseAssessment('[{"pattern":"none","score":0.9,"reason":"clean"}]');
        assert.equal(result.findings[0].pattern, "none");
        assert.equal(result.findings[0].score, 0);
    });
});

describe("buildPrompt — asking for a list", () => {
    it("asks for one verdict by default", async () => {
        const fake = fakeProvider('{"pattern":"none","score":0,"reason":"fine"}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: "const x = 1;"
        });

        assert.ok(fake.lastPrompt.includes("Identify the single most likely runtime failure"));
        assert.ok(!fake.lastPrompt.includes('"findings"'));
    });

    it("asks for every demonstrable finding under multi", async () => {
        const fake = fakeProvider('{"findings":[],"checked":[]}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: "const x = 1;",
            multi: true
        });

        assert.ok(fake.lastPrompt.includes("Identify every runtime failure in that source"));
        assert.ok(fake.lastPrompt.includes('"findings": [{"pattern"'));
        assert.ok(fake.lastPrompt.includes('Order "findings" by score, highest first'));
    });

    it("states that a list is not a lower bar", async () => {
        // The risk of asking for more than one finding is that the list reads
        // as a quota, and the second-best candidate in a clean file is exactly
        // what a false positive is made of.
        const fake = fakeProvider('{"findings":[]}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: "const x = 1;",
            multi: true
        });

        assert.ok(fake.lastPrompt.includes("A list is not a lower bar"));
        assert.ok(fake.lastPrompt.includes("Do not pad the"));
        assert.ok(fake.lastPrompt.includes("do not report the same defect twice"));
        // The evidence policy still governs every finding.
        assert.ok(fake.lastPrompt.includes(">= 0.70"));
    });

    it("keeps coverage outside the list, where it describes the file", async () => {
        const fake = fakeProvider('{"findings":[]}');
        await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "a.js",
            code: "const x = 1;",
            multi: true
        });

        assert.ok(fake.lastPrompt.includes("belongs outside the list, once"));
    });

    it("reports truncation once for the whole assessment, not per finding", async () => {
        const fake = fakeProvider(
            '{"findings":[{"pattern":"off_by_one","score":0.8,"reason":"a"},' +
                '{"pattern":"resource_leak","score":0.6,"reason":"b"}]}'
        );
        const result = await predictBug({
            provider: fake.provider,
            location: { file: "fake" },
            filePath: "big.js",
            code: "let a = 1;\n".repeat(20_000),
            multi: true
        });

        assert.equal(result.findings.length, 2);
        assert.match(result.truncated ?? "", /covers the first \d+ of 20001 lines/);
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
