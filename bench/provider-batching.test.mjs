import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchPrompt, parseBatch, copilotUsage } from './provider-batching.mjs';
import { summarizeBatching } from './batching-summary.mjs';
import { createHash } from 'node:crypto';

const verdict = (id, score = 0.8) => ({ id, pattern: 'null_reference', score, line: 3, reason: 'An absent value is dereferenced.' });

test('batch replies match by id, never response position', () => {
    const result = parseBatch(JSON.stringify({ results: [verdict(1, 0.6), verdict(0, 0.9)] }), 2);
    assert.deepEqual(result.map(r => r.findings[0].score), [0.9, 0.6]);
});

test('missing and duplicate results stay unavailable, not clean or borrowed from another file', () => {
    const result = parseBatch(JSON.stringify({ results: [verdict(1), verdict(1), verdict(2), verdict(99)] }), 3);
    assert.deepEqual(result.map(r => r.findings[0].pattern), ['unknown', 'unknown', 'null_reference']);
});

test('malformed batch output never claims files are clean', () => {
    for (const raw of ['', '{"results":', '{"results":{}}', '[]', 'null']) {
        assert.ok(parseBatch(raw, 2).every(r => r.findings[0].pattern === 'unknown'));
    }
});

test('single-file prompts and score parsing retain existing behavior', () => {
    assert.equal(batchPrompt([{ prompt: 'Original prompt' }]), 'Original prompt');
    assert.equal(parseBatch(JSON.stringify(verdict(0, 0.5)), 1)[0].findings[0].score, 0.5);
});

test('batching shares policy but retains every source and imported definition', () => {
    const prompt = name => 'POLICY\n"checked" is a coverage record.\nSCHEMA\nFile name (untrusted): ' + name +
        '\n----- BEGIN SOURCE -----\n1|source-' + name + '\n----- END SOURCE -----\ncallee-' + name;
    const result = batchPrompt(['a', 'b'].map(name => ({ prompt: prompt(name) })));
    assert.equal(result.split('POLICY').length - 1, 1);
    for (const name of ['a', 'b']) {
        assert.ok(result.includes('source-' + name));
        assert.ok(result.includes('callee-' + name));
    }
});

test('Copilot accounting includes cache reads/writes once and does not invent dollar costs', () => {
    const tokenDetails = Object.fromEntries(Object.entries({ input: 2, output: 5, cache_read: 11, cache_write: 7 })
        .map(([key, tokenCount]) => [key, { tokenCount }]));
    const result = copilotUsage({ tokenDetails, totalPremiumRequestCost: 1 });
    assert.equal(result.total, 25);
    assert.equal(result.cost, null);
    delete tokenDetails.cache_write;
    assert.equal(copilotUsage({ tokenDetails }), null);
});

test('summary refuses incomplete, stale, or duplicate evidence', () => {
    const hash = text => createHash('sha256').update(text).digest('hex');
    const raw = JSON.stringify({ pattern: 'none', score: 0, reason: '' });
    const data = { status: 'complete', config: { provider: 'codex', size: 1, trials: 1,
        targets: [{ file: 'clean.js', kind: 'clean', sourceHash: 'source' }] }, calls: [{
        id: '1/0', trial: 1, files: ['clean.js'], code: 0, prompt: 'prompt', promptHash: hash('prompt'),
        raw, responseHash: hash(raw), tokens: { input: 3, cacheRead: 2, output: 1, total: 4 },
        estimatedPromptTokens: 1, wallMs: 1
    }] };
    const row = summarizeBatching(data, {}, 'example');
    assert.equal(row.total, 4);
    assert.equal(row.input, 1);
    assert.equal(row.cacheRead, 2);
    assert.throws(() => summarizeBatching({ ...data, status: 'running' }, {}, 'example'), /Incomplete/);
    assert.throws(() => summarizeBatching({ ...data, calls: [] }, {}, 'example'), /Missing/);
    assert.throws(() => summarizeBatching({ ...data, calls: [...data.calls, ...data.calls] }, {}, 'example'), /Duplicate/);
    assert.throws(() => summarizeBatching({ ...data, calls: [{ ...data.calls[0], raw: 'changed' }] }, {}, 'example'), /Stale/);
    const positive = JSON.stringify(verdict(0));
    assert.throws(() => summarizeBatching({ ...data, calls: [{ ...data.calls[0], raw: positive,
        responseHash: hash(positive) }] }, {}, 'example'), /Missing\/stale judgment/);
});
