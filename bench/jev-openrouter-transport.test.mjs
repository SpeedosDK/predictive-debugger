import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createOpenRouterTransport } from './jev-openrouter-transport.mjs';

const require = createRequire(import.meta.url);
const { createJevReviewer } = require('../out/core/prediction/jev.js');

const assessment = { findings: [{ pattern: 'null-reference', score: 0.9, line: 1, reason: 'Input can be null.' }] };
const code = 'export function getName(value) { return value.name; }\n';

function fixture({ capture = {}, usage = { prompt_tokens: 900, completion_tokens: 20 } } = {}) {
    return async (url, init) => {
        capture.url = url;
        capture.body = JSON.parse(init.body);
        capture.auth = new Headers(init.headers).get('authorization');
        const answer = { type: 'score', score: 4, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 } };
        return Response.json({ model: 'typesafe/jev-1.13', usage,
            answers: Object.fromEntries(Object.keys(capture.body.questions).map(id => [id, answer])) });
    };
}

test('rewrites the model id in both directions so the shipped validator stays strict', async () => {
    const capture = {};
    const review = createJevReviewer({ apiKey: 'sk-or-v1-test', request: createOpenRouterTransport({ request: fixture({ capture }) }) });
    const result = await review({ code, callees: [], assessment });

    assert.equal(capture.url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(capture.body.model, 'typesafe/jev-1.13');
    assert.equal(capture.auth, 'Bearer sk-or-v1-test');
    // The reply said typesafe/jev-1.13; jev.ts only accepts jev-1.13.0, and still parsed it.
    assert.equal(result.status, 'scored');
    assert.equal(result.model, 'jev-1.13.0');
    assert.equal(result.findings[0].priority, 1);
});

test('maps OpenRouter usage field names', async () => {
    const review = createJevReviewer({ apiKey: 'sk-or-v1-test', request: createOpenRouterTransport({ request: fixture() }) });
    const result = await review({ code, callees: [], assessment });
    assert.deepEqual(result.usage, { inputTokens: 900, outputTokens: 20 });
});

test('prefers native token fields when the upstream already uses them', async () => {
    const review = createJevReviewer({ apiKey: 'sk-or-v1-test',
        request: createOpenRouterTransport({ request: fixture({ usage: { input_tokens: 5, output_tokens: 6 } }) }) });
    const result = await review({ code, callees: [], assessment });
    assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 6 });
});

test('passes upstream failures through as the reviewer category, not a body', async () => {
    const review = createJevReviewer({ apiKey: 'sk-or-v1-test', request: createOpenRouterTransport({
        request: async () => new Response('Insufficient credits. purchase more at ...', { status: 402 }) }) });
    const result = await review({ code, callees: [], assessment });
    assert.deepEqual(result, { status: 'unavailable', reason: 'service' });
});

test('reports an unparseable upstream body as a failure rather than throwing', async () => {
    const review = createJevReviewer({ apiKey: 'sk-or-v1-test', request: createOpenRouterTransport({
        request: async () => new Response('<html>gateway</html>', { status: 200 }) }) });
    const result = await review({ code, callees: [], assessment });
    assert.equal(result.status, 'unavailable');
});
