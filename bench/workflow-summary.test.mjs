import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usage, summarize } from './workflow-summary.mjs';
test('usage counts cache reads and writes once, alongside fresh input and output', () => {
    assert.deepEqual(usage({ usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40 }, total_cost_usd: 0.5 }),
    { input: 10, output: 20, cacheWrite: 30, cacheRead: 40, total: 100, cost: 0.5 });
});
test('missing accounting and unfinished comparisons cannot become graphs', () => {
    assert.throws(() => usage({ usage: {} }), /Missing CLI/);
    assert.throws(() => summarize({ status: 'blocked' }, {}), /incomplete/);
});
test('model accounting includes auxiliary model calls omitted by top-level usage', () => {
    const model = { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 };
    assert.equal(usage({ modelUsage: { sonnet: model, helper: model }, total_cost_usd: 1 }).total, 20);
});
test('complete workflow totals include internal calls and require matching defect judgments', () => {
    const report = { usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4 }, total_cost_usd: 0.1 };
    const runs = ['read', 'previous', 'current'].map(arm => ({ id: `${arm}#1`, arm, trial: 1,
        promptHash: 'prompt', responseHash: 'response', report, wallMs: 10,
        internal: arm === 'read' ? [] : [{ report }], verdicts: [{ file: 'bug.js', defect: true }] }));
    const data = { status: 'complete', config: { trials: 1, targets: [{ file: 'bug.js', kind: 'buggy', sourceHash: 'source' }] }, runs };
    const judgments = Object.fromEntries(runs.map(r => [`${r.id}/bug.js`, {
        matchesDefect: true, sourceHash: 'source', promptHash: 'prompt', responseHash: 'response' }]));
    const rows = summarize(data, judgments);
    assert.equal(rows[0].total.total, 10);
    assert.equal(rows[2].total.total, 20);
    assert.equal(rows[2].total.cost, 0.2);
    judgments['current#1/bug.js'].matchesDefect = false;
    assert.equal(summarize(data, judgments)[2].detected, 0);
    judgments['current#1/bug.js'].validDefect = true;
    assert.equal(summarize(data, judgments)[2].otherVerified, 1);
    judgments['current#1/bug.js'].sourceHash = 'stale';
    assert.throws(() => summarize(data, judgments), /stale judgment/);
    runs[2].internal = [];
    assert.throws(() => summarize(data, judgments), /Missing internal/);
});
