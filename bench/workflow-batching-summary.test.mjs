import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { providerUsage, summarizeWorkflows, judgmentKey } from './workflow-batching-summary.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const report = [{ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } }];
const record = (prompt, response) => ({ prompt, response, promptHash: hash(prompt), responseHash: hash(response), report });

test('Codex cache and reasoning subsets are not added to token totals', () => {
    const result = providerUsage('codex', report);
    assert.equal(result.total, 110);
    assert.equal(result.input, 40);
    assert.equal(result.cacheRead, 60);
    assert.equal(result.cost, null);
    assert.throws(() => providerUsage('codex', []), /Missing/);
});

test('workflow summaries bind judgments and require all internal file reviews', () => {
    const file = 'corpus/example.ts';
    const config = { provider: 'codex', bundles: { current: 'build' }, targets: [{ file, kind: 'buggy', sourceHash: 'source' }] };
    const call = { ...record('File name (untrusted): "C:/temp/source/corpus/example.ts"',
        '{"pattern":"other","score":0.9,"reason":"wrong result"}'), code: 0 };
    const run = { ...record('review', 'answer'), id: 'current#1', arm: 'current', trial: 1, failed: false,
        internal: [call], verdicts: [{ file, defect: true }], wallMs: 1 };
    const data = { config, configHash: hash(JSON.stringify(config)), runs: [run] };
    const judgments = { [judgmentKey('codex', run, file)]: { sourceHash: 'source', promptHash: run.promptHash,
        responseHash: run.responseHash, matchesDefect: true } };
    const [result] = summarizeWorkflows(data, judgments);
    assert.equal(result.detected, 1);
    assert.equal(result.total.total, 220);
    assert.throws(() => summarizeWorkflows(data, {}), /judgment/);
    call.response += 'changed';
    assert.throws(() => summarizeWorkflows(data, judgments), /hash/);
    run.internal = [];
    assert.throws(() => summarizeWorkflows(data, judgments), /coverage/);
    run.failed = true;
    run.report = [];
    const [failed] = summarizeWorkflows(data, judgments);
    assert.equal(failed.unavailable, 1);
    assert.equal(failed.detected, 0);
    assert.equal(failed.total, null);
});
