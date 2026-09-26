import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeUsage, copilotUsage, providerUsage } from './usage.mjs';

test('Codex cache and reasoning subsets are not added to token totals', () => {
    const report = [{ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } }];
    const result = providerUsage('codex', report);
    assert.equal(result.total, 110);
    assert.equal(result.input, 40);
    assert.equal(result.cacheRead, 60);
    assert.equal(result.cost, null);
    assert.throws(() => providerUsage('codex', []), /Missing/);
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

test('Claude usage counts cache reads and writes once, alongside fresh input and output', () => {
    assert.deepEqual(claudeUsage({ usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40 }, total_cost_usd: 0.5 }),
    { input: 10, output: 20, cacheWrite: 30, cacheRead: 40, total: 100, cost: 0.5 });
    assert.throws(() => claudeUsage({ usage: {} }), /Missing CLI/);
});

test('Claude model accounting includes auxiliary model calls omitted by top-level usage', () => {
    const model = { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 };
    assert.equal(claudeUsage({ modelUsage: { sonnet: model, helper: model }, total_cost_usd: 1 }).total, 20);
});
