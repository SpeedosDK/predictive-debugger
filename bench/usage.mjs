/** Token accounting for captured CLI calls: each cache category counted once, no invented dollar costs. */
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

/**
 * Whether a verdict cites one of the generator-made defects in manifest.discovered. Such a
 * verdict is a verified finding with separate credit: not the planted bug, not a false alarm.
 */
export function namesDiscoveredDefect(file, line) {
    const entry = (manifest.discovered ?? []).find(d => `corpus/${d.file}` === file);
    return Boolean(entry && typeof line === 'number' && entry.acceptableRanges.some(([s, e]) => line >= s && line <= e));
}

/**
 * Claude's own report. `modelUsage` is preferred because it includes auxiliary model
 * calls that the top-level `usage` omits.
 */
export function claudeUsage(report) {
    if (report?.modelUsage && Object.keys(report.modelUsage).length) {
        const result = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0, cost: report.total_cost_usd };
        if (!Number.isFinite(result.cost) || result.cost < 0) throw Error('Missing CLI usage or cost.');
        for (const model of Object.values(report.modelUsage)) {
            for (const [key, field] of Object.entries({ input: 'inputTokens', output: 'outputTokens',
                cacheWrite: 'cacheCreationInputTokens', cacheRead: 'cacheReadInputTokens' })) {
                if (!Number.isFinite(model[field]) || model[field] < 0) throw Error('Missing CLI model usage.');
                result[key] += model[field]; result.total += model[field];
            }
        }
        return result;
    }
    const u = report?.usage;
    const keys = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
    if (!u || keys.some(key => !Number.isFinite(u[key]) || u[key] < 0) ||
        !Number.isFinite(report.total_cost_usd) || report.total_cost_usd < 0) {
        throw Error('Missing CLI usage or cost; cannot claim complete accounting.');
    }
    return { input: u.input_tokens, output: u.output_tokens,
        cacheWrite: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens,
        total: keys.reduce((sum, key) => sum + u[key], 0), cost: report.total_cost_usd };
}

const empty = () => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0,
    cost: null, premiumRequests: null, nanoAiu: null });

export function copilotUsage(report) {
    const fields = { input: 'input', output: 'output', cacheWrite: 'cache_write', cacheRead: 'cache_read' };
    const values = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, report?.tokenDetails?.[field]?.tokenCount]));
    if (Object.values(values).some(n => !Number.isFinite(n) || n < 0)) return null;
    return { ...values, total: Object.values(values).reduce((a, b) => a + b, 0), cost: null };
}

/** Claude reports its own usage; Codex cached input is part of input and reasoning part of output. */
export function providerUsage(provider, report) {
    if (provider === 'claude') return { ...empty(), ...claudeUsage(report) };
    if (provider === 'copilot') {
        const tokens = copilotUsage(report);
        if (!tokens) throw Error('Missing Copilot token accounting.');
        return { ...empty(), ...tokens, premiumRequests: report.totalPremiumRequestCost ?? null,
            nanoAiu: report.totalNanoAiu ?? null };
    }
    const turns = report?.filter(e => e.type === 'turn.completed');
    if (!turns?.length) throw Error('Missing Codex token accounting.');
    const result = empty();
    for (const { usage: u } of turns) {
        if (!u || ['input_tokens', 'cached_input_tokens', 'output_tokens'].some(k => !Number.isFinite(u[k]) || u[k] < 0) ||
            u.cached_input_tokens > u.input_tokens) throw Error('Invalid Codex token accounting.');
        result.input += u.input_tokens - u.cached_input_tokens;
        result.cacheRead += u.cached_input_tokens;
        result.output += u.output_tokens;
        result.total += u.input_tokens + u.output_tokens;
    }
    return result;
}
