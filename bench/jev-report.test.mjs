import assert from 'node:assert/strict';
import test from 'node:test';
import { auc, report } from './jev-report.mjs';

test('auc scores perfect separation and inversion', () => {
    assert.equal(auc([1, 2], [0]), 1);
    assert.equal(auc([0], [1, 2]), 0);
});

test('auc counts ties as half', () => {
    assert.equal(auc([1, 1], [1, 1]), 0.5);
    assert.equal(auc([1], [1]), 0.5);
    // One clear win, one clear win, one tie: 3.5 of 4 pairs.
    assert.equal(auc([2, 1], [1, 0]), 0.875);
});

test('auc is undefined without both classes', () => {
    assert.equal(auc([1, 2], []), null);
    assert.equal(auc([], [1]), null);
});

const row = (overrides) => ({
    id: 'current#1/corpus/a.js', arm: 'current', trial: 1, file: 'corpus/a.js', kind: 'buggy',
    stratum: 'judged', correct: true, basis: 'test', pattern: 'null-reference', line: 3, cliScore: 0.9,
    status: 'scored', reason: null, wallMs: 10, evidence: { score: 1, confidence: 0.9 },
    impact: { score: 1, confidence: 0.9 }, priority: 1, usage: { inputTokens: 100, outputTokens: 10 },
    truncated: null, calleeCount: 0, ...overrides
});
const saved = (scored) => ({
    config: { mode: 'simulated transport', source: 's.json', sourceHash: 'a'.repeat(64), jevHash: 'b'.repeat(64) },
    status: 'complete', scored
});

test('report separates strata and totals only scored usage', () => {
    const text = report(saved([
        row({}),
        row({ id: 'x', correct: false, kind: 'clean', evidence: { score: 0, confidence: 0.4 }, impact: { score: 0, confidence: 0.4 }, priority: 0 }),
        row({ id: 'y', stratum: 'below-cut', correct: false }),
        row({ id: 'z', status: 'unavailable', reason: 'timeout', evidence: null, impact: null, priority: null, usage: null })
    ]));
    assert.match(text, /4 findings replayed; 3 returned a score/);
    assert.match(text, /unavailable:timeout 1/);
    assert.match(text, /## Reviewer-judged findings/);
    assert.match(text, /## Findings below the actionable cut/);
    // Perfect separation on the judged stratum, and the unavailable row contributes no tokens.
    assert.match(text, /\| Jev evidence \| 1\.000 \|/);
    // The comparison that matters: Jev is scored against the free ordering, not against chance.
    assert.match(text, /\| Tool score \(free, this is "no Jev"\) \| 0\.500 \|/);
    assert.match(text, /Jev's ranking beats the free baseline by 0\.500/);
    assert.match(text, /Input tokens 300, output tokens 30/);
    assert.match(text, /cannot support a confident claim/);
});

test('report states when a class is empty rather than inventing an AUC', () => {
    const text = report(saved([row({}), row({ id: 'b' })]));
    assert.match(text, /No separation measurable: the wrong group is empty/);
    assert.doesNotMatch(text, /Ranking signal/);
});
