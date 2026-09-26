import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { BugInput, clearVerdictCache, parseAssessment, parseBatchAssessment, predictBugs } from "../core/prediction/predictBug";

beforeEach(clearVerdictCache);
import { CliProvider } from "../providers/types";

function options(reply: (prompt: string) => string | Promise<string>) {
    const provider: CliProvider = {
        id: "codex", label: "test", installHint: "", locate: async () => ({ file: "test" }),
        checkAuth: () => ({ hasCredentials: true }),
        complete: async (_location, request) => reply(request.prompt)
    };
    return { provider, location: { file: "test" } };
}
const inputs: BugInput[] = [
    { filePath: "a.js", code: "one\ntwo\nthree" },
    { filePath: "b.js", code: "one" }
];

test("batch results use ids and validate each file's own source ranges", async () => {
    const results = await predictBugs(inputs, options(() => JSON.stringify({ results: [
        { id: 1, pattern: "other", score: 0.9, line: 3, reason: "outside b.js" },
        { id: 0, pattern: "other", score: 0.9, line: 3, reason: "inside a.js" }
    ] })));
    assert.equal(results[0].kind, "assessment");
    assert.equal(results[1].kind, "assessment");
    if (results[0].kind !== "assessment" || results[1].kind !== "assessment") throw Error("missing results");
    assert.equal(results[0].assessment.findings[0].reason, "inside a.js");
    assert.equal(results[1].assessment.findings[0].pattern, "unknown");
});

test("one bad id does not discard its valid neighbor", () => {
    const rows = parseBatchAssessment(JSON.stringify({ results: [
        { id: 0, pattern: "none", score: 0 }, { id: 0, pattern: "none", score: 0 },
        { id: 1, findings: [], checked: ["other"] }, { id: 99, pattern: "none", score: 0 }
    ] }), 3);
    assert.deepEqual(rows.map(row => row.findings[0].pattern), ["unknown", "none", "unknown"]);
});

test("an explicit unavailable reply is not reclassified as clean", () => {
    const rows = parseBatchAssessment(JSON.stringify({ results: [
        { id: 0, pattern: "unknown", score: 0, reason: "Cannot assess this file." },
        { id: 1, pattern: "none", score: 0 }
    ] }), 2);
    assert.deepEqual(rows.map(row => row.findings[0].pattern), ["unknown", "none"]);
});

test("interrupted empty findings and malformed entries never become clean", () => {
    for (const raw of ['{"results":[{"id":0,"findings":[', '{"results":[{"id":0}]}',
        '{"results":[null]}', '{"results":[{"id":0,"findings":[null]}]}']) {
        assert.equal(parseBatchAssessment(raw, 1)[0].findings[0].pattern, "unknown");
    }
});

test("multi findings retain independent scores and file attribution", async () => {
    const results = await predictBugs(inputs, { ...options(prompt => {
        assert.match(prompt, /"results"/);
        assert.match(prompt, /"findings"/);
        return JSON.stringify({ results: [
            { id: 0, findings: [{ pattern: "other", score: 0.5, line: 1 }, { pattern: "resource_leak", score: 0.9, line: 2 }] },
            { id: 1, findings: [] }
        ] });
    }), multi: true });
    if (results[0].kind !== "assessment" || results[1].kind !== "assessment") throw Error("missing results");
    assert.deepEqual(results[0].assessment.findings.map(finding => finding.score), [0.9, 0.5]);
    assert.equal(results[1].assessment.findings[0].pattern, "none");
});

test("large sources stay singleton with their original coverage", async () => {
    const prompts: string[] = [];
    const code = `// ${"x".repeat(118_000)} final-marker`;
    const result = await predictBugs([{ filePath: "large.js", code }, inputs[1]], options(prompt => {
        prompts.push(prompt);
        return '{"pattern":"none","score":0}';
    }));
    assert.equal(prompts.length, 2);
    assert.ok(prompts[0].includes("final-marker"));
    assert.equal(result.length, 2);
});

test("aborting after a completed group keeps its paid-for results", async () => {
    const controller = new AbortController();
    let calls = 0;
    const many = Array.from({ length: 17 }, (_, i) => ({ filePath: `${i}.js`, code: "const a = 1;" }));
    const result = await predictBugs(many, { ...options(prompt => {
        calls++;
        controller.abort();
        const ids = [...prompt.matchAll(/^REVIEW ID: (\d+)$/gm)].map(m => Number(m[1]));
        return JSON.stringify({ results: ids.map(id => ({ id, findings: [] })) });
    }), signal: controller.signal });
    assert.equal(calls, 1);
    assert.equal(result.filter(outcome => outcome.kind === "assessment").length, 8);
    assert.equal(result.filter(outcome => outcome.kind === "cancelled").length, 9);
});

test("an uncertain group verdict is re-checked alone and the single-file verdict replaces it", async () => {
    const prompts: string[] = [];
    const results = await predictBugs(inputs, options(prompt => {
        prompts.push(prompt);
        if (prompt.includes("REVIEW ID:")) {
            return JSON.stringify({ results: [
                { id: 0, pattern: "off_by_one", score: 0.5, line: 2, reason: "group" },
                { id: 1, pattern: "none", score: 0 }
            ] });
        }
        return '{"pattern":"off_by_one","score":0.8,"line":2,"reason":"alone"}';
    }));
    assert.equal(prompts.length, 2);
    assert.ok(prompts[1].includes('"a.js"') && !prompts[1].includes('"b.js"'));
    if (results[0].kind !== "assessment" || results[1].kind !== "assessment") throw Error("missing results");
    assert.equal(results[0].assessment.findings[0].reason, "alone");
    assert.equal(results[1].assessment.findings[0].pattern, "none");
});

test("actionable, clean and unavailable group verdicts are not re-checked", async () => {
    let calls = 0;
    const three = [...inputs, { filePath: "c.js", code: "one" }];
    await predictBugs(three, options(() => {
        calls++;
        return JSON.stringify({ results: [
            { id: 0, pattern: "other", score: 0.9, line: 1 },
            { id: 1, pattern: "none", score: 0 },
            { id: 2, pattern: "unknown", score: 0 }
        ] });
    }));
    assert.equal(calls, 1);
});

test("a failed re-check keeps the group verdict", async () => {
    const results = await predictBugs(inputs, options(prompt => {
        if (!prompt.includes("REVIEW ID:")) throw new Error("rate limited");
        return JSON.stringify({ results: [
            { id: 0, pattern: "other", score: 0.4, line: 1, reason: "group" },
            { id: 1, pattern: "none", score: 0 }
        ] });
    }));
    if (results[0].kind !== "assessment") throw Error("missing result");
    assert.equal(results[0].assessment.findings[0].reason, "group");
});

test("a group verdict just over the gate is re-checked, and a clean single-file verdict clears it", async () => {
    const results = await predictBugs(inputs, options(prompt => prompt.includes("REVIEW ID:")
        ? JSON.stringify({ results: [
            { id: 0, pattern: "null_reference", score: 0.72, line: 1, reason: "group" },
            { id: 1, pattern: "none", score: 0 }
        ] })
        : '{"pattern":"none","score":0,"reason":"alone"}'));
    if (results[0].kind !== "assessment") throw Error("missing result");
    assert.equal(results[0].assessment.findings[0].pattern, "none");
});

test("brackets in prose before the verdict do not hide it", () => {
    const verdict = '{"pattern":"other","score":0.8,"line":3,"reason":"x"}';
    for (const prose of ["Checked [race_condition] first. ", "See line [12]: "]) {
        assert.equal(parseAssessment(prose + verdict).findings[0].pattern, "other");
    }
    const batch = parseBatchAssessment('Result [ok] {"results":[{"id":0,"pattern":"none","score":0}]}', 1);
    assert.equal(batch[0].findings[0].pattern, "none");
});

test("the CLI runs in an empty directory, not the project, and it is removed afterwards", async () => {
    const fs = await import("node:fs");
    const seen: string[] = [];
    const provider: CliProvider = {
        id: "codex", label: "test", installHint: "", locate: async () => ({ file: "test" }),
        checkAuth: () => ({ hasCredentials: true }),
        complete: async (_location, request) => {
            assert.ok(request.cwd && request.cwd !== process.cwd());
            assert.deepEqual(fs.readdirSync(request.cwd), []);
            seen.push(request.cwd);
            return '{"pattern":"none","score":0}';
        }
    };
    await predictBugs([inputs[1]], { provider, location: { file: "test" } });
    assert.equal(seen.length, 1);
    assert.equal(fs.existsSync(seen[0]), false);
});

test("a flagged file that its group calls clean is re-checked alone; an unflagged one is not", async () => {
    const prompts: string[] = [];
    const results = await predictBugs([{ ...inputs[0], recheckIfClean: true }, inputs[1]], options(prompt => {
        prompts.push(prompt);
        return prompt.includes("REVIEW ID:")
            ? JSON.stringify({ results: [{ id: 0, pattern: "none", score: 0 }, { id: 1, pattern: "none", score: 0 }] })
            : '{"pattern":"race_condition","score":0.8,"line":2,"reason":"alone"}';
    }));
    assert.equal(prompts.length, 2);
    assert.ok(prompts[1].includes('"a.js"') && !prompts[1].includes('"b.js"'));
    if (results[0].kind !== "assessment") throw Error("missing result");
    assert.equal(results[0].assessment.findings[0].reason, "alone");
});

test("an unreadable re-check reply keeps the group verdict", async () => {
    const results = await predictBugs(inputs, options(prompt => prompt.includes("REVIEW ID:")
        ? JSON.stringify({ results: [
            { id: 0, pattern: "other", score: 0.5, line: 1, reason: "group" },
            { id: 1, pattern: "none", score: 0 }
        ] })
        : "I could not decide."));
    if (results[0].kind !== "assessment") throw Error("missing result");
    assert.equal(results[0].assessment.findings[0].reason, "group");
});

test("stops calling a provider after two failures in a row and reports why", async () => {
    let calls = 0;
    const many = Array.from({ length: 40 }, (_, i) => ({ filePath: `${i}.js`, code: "const a = 1;" }));
    const results = await predictBugs(many, { ...options(() => {
        calls++;
        throw new Error("CLI timed out");
    }), concurrency: 1 });
    assert.equal(calls, 2);
    assert.ok(results.every(r => r.kind === "failure"));
    const last = results[results.length - 1];
    if (last.kind !== "failure") throw Error("expected failure");
    assert.match(last.reason, /Stopped after repeated provider failures: CLI timed out/);
});

test("a success between failures keeps the provider in use", async () => {
    let calls = 0;
    const many = Array.from({ length: 24 }, (_, i) => ({ filePath: `${i}.js`, code: "const a = 1;" }));
    await predictBugs(many, { ...options(prompt => {
        calls++;
        if (calls !== 2) throw new Error("flaky");
        const ids = [...prompt.matchAll(/^REVIEW ID: (\d+)$/gm)].map(m => Number(m[1]));
        return JSON.stringify({ results: ids.map(id => ({ id, pattern: "none", score: 0 })) });
    }), concurrency: 1 });
    assert.equal(calls, 3);
});

test("a group's re-check starts before slower groups finish", async () => {
    const order: string[] = [];
    const many = Array.from({ length: 16 }, (_, i) => ({ filePath: `${i}.js`, code: `// f${i}` }));
    await predictBugs(many, { ...options(async prompt => {
        if (!prompt.includes("REVIEW ID:")) { order.push("recheck"); return '{"pattern":"none","score":0}'; }
        const slow = prompt.includes('"8.js"');
        await new Promise(r => setTimeout(r, slow ? 80 : 5));
        order.push(slow ? "slow group" : "fast group");
        const ids = [...prompt.matchAll(/^REVIEW ID: (\d+)$/gm)].map(m => Number(m[1]));
        return JSON.stringify({ results: ids.map(id => ({ id, pattern: id === 0 && !slow ? "other" : "none", score: id === 0 && !slow ? 0.5 : 0, line: 1 })) });
    }), concurrency: 2 });
    assert.deepEqual(order, ["fast group", "recheck", "slow group"]);
});

test("an unchanged file is not reviewed twice; a changed one is, and failures are never reused", async () => {
    let calls = 0;
    const reply = options(() => { calls++; return '{"pattern":"none","score":0}'; });
    const first = await predictBugs([inputs[1]], reply);
    const second = await predictBugs([inputs[1]], reply);
    assert.equal(calls, 1);
    if (first[0].kind !== "assessment" || second[0].kind !== "assessment") throw Error("missing result");
    assert.equal(first[0].assessment.cached, undefined);
    assert.equal(second[0].assessment.cached, true);
    await predictBugs([{ ...inputs[1], code: "two" }], reply);
    assert.equal(calls, 2);
    await predictBugs([inputs[1]], { ...reply, model: "other-model" });
    assert.equal(calls, 3);
    await predictBugs([inputs[1]], { ...reply, cache: false });
    assert.equal(calls, 4);

    let failing = 0;
    const broken = options(() => { failing++; return "not json"; });
    await predictBugs([{ filePath: "u.js", code: "x" }], broken);
    await predictBugs([{ filePath: "u.js", code: "x" }], broken);
    assert.equal(failing, 2);
});
