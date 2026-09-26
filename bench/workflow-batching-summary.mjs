import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { usage } from './workflow-summary.mjs';
import { copilotUsage } from './provider-batching.mjs';

const require = createRequire(import.meta.url);
const { parseAssessment, parseBatchAssessment } = require('../out/core/prediction/predictBug.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const empty = () => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0,
    cost: null, premiumRequests: null, nanoAiu: null });

export function providerUsage(provider, report) {
    if (provider === 'claude') return { ...empty(), ...usage(report) };
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

function add(a, b) {
    for (const key of Object.keys(a)) if (typeof b[key] === 'number') a[key] = (a[key] ?? 0) + b[key];
}

export function judgmentKey(provider, run, file) {
    return `${provider}/${run.promptHash}/${run.responseHash}/${file}`;
}

function checkHashes(record) {
    if (hash(record.prompt) !== record.promptHash || hash(record.response) !== record.responseHash) throw Error('Stale prompt/response hash.');
}

function reviewedFiles(prompt) {
    return [...prompt.matchAll(/^File name \(untrusted\): (".*")$/gm)].map(match => {
        const parts = JSON.parse(match[1]).split(/[\\/]+/);
        return parts.slice(parts.lastIndexOf('source') + 1).join('/');
    });
}

export function summarizeWorkflows(data, judgments) {
    const { config } = data;
    if (hash(JSON.stringify(config)) !== data.configHash) throw Error('Stale configuration hash.');
    const ids = new Set();
    return data.runs.map(run => {
        if (ids.has(run.id)) throw Error('Duplicate workflow.');
        ids.add(run.id);
        checkHashes(run);
        let caller;
        try { caller = providerUsage(config.provider, run.report); }
        catch (error) { if (!run.failed) throw error; caller = null; }
        const row = { provider: config.provider, arm: run.arm, trial: run.trial, failed: run.failed,
            bundle: config.bundles[run.arm] ?? null, cases: config.targets.length, bugs: 0, detected: 0,
            otherVerified: 0, controls: 0, falseAlarms: 0, verifiedControlFindings: 0, unavailable: 0,
            internalCalls: run.internal.length, caller, internal: empty(),
            wallMs: run.wallMs, maxTaskPromptTokens: 0, maxCallInputTokens: 0 };
        const seen = new Set(), unavailable = new Set();
        for (const call of run.internal) {
            checkHashes(call);
            const tokens = providerUsage(config.provider, call.report);
            add(row.internal, tokens);
            const files = reviewedFiles(call.prompt);
            if (!files.length) throw Error('Unrecognized internal prompt.');
            const assessments = files.length === 1 ? [parseAssessment(call.response)] : parseBatchAssessment(call.response, files.length);
            for (const [i, file] of files.entries()) {
                if (seen.has(file) || !config.targets.some(t => t.file === file)) throw Error('Duplicate or unexpected internal review.');
                seen.add(file);
                if (call.code !== 0 || assessments[i].findings.some(f => f.pattern === 'unknown')) unavailable.add(file);
            }
            const { encode } = require('gpt-tokenizer');
            row.maxTaskPromptTokens = Math.max(row.maxTaskPromptTokens, encode(call.prompt).length);
            // Copilot exposes the last request; Codex only exposes a turn aggregate.
            if (config.provider === 'copilot') row.maxCallInputTokens = Math.max(row.maxCallInputTokens, call.report.lastCallInputTokens ?? 0);
        }
        if (!run.failed && (run.arm === 'read' ? seen.size !== 0 : seen.size !== config.targets.length)) throw Error('Incomplete internal coverage.');
        for (const target of config.targets) {
            if (target.kind === 'buggy') row.bugs++; else row.controls++;
            const verdicts = (run.verdicts ?? []).filter(v => v.file === target.file);
            if (verdicts.length !== 1 || typeof verdicts[0].defect !== 'boolean' || unavailable.has(target.file) ||
                (run.arm !== 'read' && !seen.has(target.file))) { row.unavailable++; continue; }
            if (!verdicts[0].defect) continue;
            const j = judgments[judgmentKey(config.provider, run, target.file)];
            if (!j || j.sourceHash !== target.sourceHash || j.promptHash !== run.promptHash || j.responseHash !== run.responseHash ||
                typeof j.matchesDefect !== 'boolean') throw Error(`Missing/stale judgment: ${run.id}/${target.file}`);
            if (target.kind === 'buggy') {
                if (j.matchesDefect) row.detected++;
                else if (j.validDefect) row.otherVerified++;
            } else {
                row.falseAlarms++;
                if (j.validDefect) row.verifiedControlFindings++;
            }
        }
        row.total = caller && !run.failed ? empty() : null;
        if (row.total) {
            add(row.total, row.caller); add(row.total, row.internal);
            if (row.total.input + row.total.cacheRead + row.total.cacheWrite + row.total.output !== row.total.total) throw Error('Token totals do not reconcile.');
        }
        return row;
    });
}

async function main() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const judgments = JSON.parse(await fs.readFile(path.join(here, 'judgments-workflow-batching.json'), 'utf8'));
    const results = [];
    for (const file of (await fs.readdir(here)).filter(f => /^results-workflow-batching-.*\.json$/.test(f))) {
        const bytes = await fs.readFile(path.join(here, file));
        const data = JSON.parse(bytes);
        if (data.status === 'running') throw Error(`Unfinished experiment: ${file}`);
        results.push({ file, sha256: hash(bytes), status: data.status, model: data.config.model,
            version: data.config.version, reusedBaselines: data.reusedBaselines,
            rows: summarizeWorkflows(data, judgments) });
    }
    console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
