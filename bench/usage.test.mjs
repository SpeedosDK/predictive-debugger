import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copilotUsage, providerUsage } from './usage.mjs';

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
