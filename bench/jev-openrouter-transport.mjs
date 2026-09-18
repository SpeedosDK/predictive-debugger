/**
 * Routes the shipped Jev reviewer through OpenRouter instead of Typesafe directly.
 *
 * Typesafe's own API is invite-only, but OpenRouter resells the same model, so this is how
 * the benchmark reaches it. Only the transport is swapped: `createJevReviewer` still builds
 * the request, enforces the context caps, validates the response and normalizes the scores,
 * so what gets measured is the code that ships, not a reimplementation of it.
 *
 * Two identifiers have to be translated at the boundary, and nothing else:
 *
 *   - Jev is `jev-1.13.0` on Typesafe and `typesafe/jev-1.13` on OpenRouter. The request
 *     carries the former; OpenRouter rejects it, and the reply carries the latter, which
 *     `responseSchema`'s literal check rejects. Rewriting both ends lets the shipped
 *     validator stay strict rather than loosening it for a benchmark.
 *   - OpenRouter reports `usage.prompt_tokens`/`completion_tokens`; jev.ts reads
 *     `input_tokens`/`output_tokens`. Mapped when the native fields are absent.
 *
 * Discovered 2026-09-18: `/api/v1/models` omits the model entirely (its modality is
 * `text->decisions`), and chat/completions answers with a 400 naming this endpoint.
 */
const DECISIONS = 'https://openrouter.ai/api/alpha/decisions';
const TYPESAFE_MODEL = 'jev-1.13.0';
const OPENROUTER_MODEL = 'typesafe/jev-1.13';

export function createOpenRouterTransport({ request = fetch, model = OPENROUTER_MODEL } = {}) {
    return async (_url, init) => {
        const sent = JSON.parse(init.body);
        const body = JSON.stringify({ ...sent, model });
        const response = await request(DECISIONS, { ...init, body });
        if (!response.ok) return response;

        let payload;
        try { payload = await response.json(); }
        catch { return new Response('unparseable upstream body', { status: 502 }); }

        const usage = payload.usage ?? {};
        return Response.json({
            ...payload,
            model: TYPESAFE_MODEL,
            usage: {
                input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
                output_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0
            }
        });
    };
}
