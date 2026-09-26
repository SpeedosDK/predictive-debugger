/** Internal-call experiment. This does not measure caller workflow or held-out accuracy. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { internalFile, usage } from './workflow-summary.mjs';

const require = createRequire(import.meta.url);
const { runProcess } = require('../out/providers/processRunner.js');
const { which } = require('../out/providers/locate.js');
const { completeArgs } = require('../out/providers/copilotCli.js');
const { parseAssessment } = require('../out/core/prediction/predictBug.js');
const { encode } = require('gpt-tokenizer');
const here = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const flag = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

export function batchPrompt(entries) {
    if (entries.length === 1) return entries[0].prompt;
    // Preserve the measured evidence policy. Use the version that covers imported definitions.
    const template = entries.find(e => e.prompt.includes('under CALLEE DEFINITIONS')) ?? entries[0];
    const end = template.prompt.indexOf('"checked" is a coverage record.');
    if (end < 0) throw Error('Unrecognized saved prompt policy.');
    const policy = template.prompt.slice(0, end)
        .replace('Identify the single most likely runtime failure in that source',
            'For EACH file, identify its single most likely runtime failure');
    return policy + [
        'Review every file independently. Definitions attached to a file are context for that file.',
        'Return one JSON object and nothing else: {"results":[{"id":0,"pattern":"none",',
        '"score":0,"line":null,"reason":"","checked":[]}]}.',
        'Include exactly one result for every supplied numeric id. Use the pattern catalogue and',
        'confidence policy above. For a defect, name its valid trigger and observable wrong result.',
        'The checked array lists the pattern ids you actually considered. Do not pad it.',
        ...entries.map((entry, id) => {
            const start = entry.prompt.indexOf('File name (untrusted):');
            if (start < 0) throw Error('Saved prompt has no source boundary.');
            return `\nREVIEW ID: ${id}\n${entry.prompt.slice(start)}\nEND REVIEW ID: ${id}`;
        })
    ].join('\n');
}

export function parseBatch(raw, count) {
    if (count === 1) return [parseAssessment(raw)];
    const unknown = () => ({ findings: [{ pattern: 'unknown', score: 0, reason: 'Missing, duplicate or malformed batch verdict.' }] });
    let results;
    try {
        const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        results = value?.results;
    } catch { return Array.from({ length: count }, unknown); }
    if (!Array.isArray(results)) return Array.from({ length: count }, unknown);
    return Array.from({ length: count }, (_, id) => {
        const matches = results.filter(r => r && r.id === id);
        return matches.length === 1 ? parseAssessment(JSON.stringify(matches[0])) : unknown();
    });
}

export function copilotUsage(report) {
    const fields = { input: 'input', output: 'output', cacheWrite: 'cache_write', cacheRead: 'cache_read' };
    const values = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, report?.tokenDetails?.[field]?.tokenCount]));
    if (Object.values(values).some(n => !Number.isFinite(n) || n < 0)) return null;
    return { ...values, total: Object.values(values).reduce((a, b) => a + b, 0), cost: null,
        note: 'Premium requests/AI credits are preserved in report, not treated as dollars.' };
}

async function invoke(provider, cli, model, prompt, cwd, callDir, isolated) {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    let args;
    if (provider === 'claude') {
        env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
        args = ['--print', '--output-format', 'json', '--tools', '', '--no-session-persistence',
            '--disable-slash-commands', '--strict-mcp-config'];
    } else if (provider === 'codex') {
        args = ['exec', '-', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only',
            '--color', 'never', '--json', '--output-last-message', path.join(callDir, 'message.txt')];
    } else {
        args = [...completeArgs(), '--usage-output-file', path.join(callDir, 'usage.json')];
        if (isolated) args.push('--available-tools=', '--no-custom-instructions');
    }
    if (model) args.push('--model', model);
    const started = Date.now();
    const result = await runProcess({ file: cli, args, input: prompt, cwd, env, timeoutMs: 240_000 });
    let raw = result.stdout, report, tokens = null, models = [];
    if (provider === 'claude') {
        report = JSON.parse(result.stdout.trim());
        raw = report.result ?? '';
        tokens = usage(report);
        models = Object.keys(report.modelUsage ?? {});
    } else if (provider === 'codex') {
        report = result.stdout.split(/\r?\n/).filter(Boolean).flatMap(line => {
            try { return [JSON.parse(line)]; } catch { return []; }
        });
        raw = await fs.readFile(path.join(callDir, 'message.txt'), 'utf8').catch(() => '');
        const turns = report.filter(e => e.type === 'turn.completed');
        if (turns.length && turns.every(e => Number.isFinite(e.usage?.input_tokens) && Number.isFinite(e.usage?.output_tokens))) {
            const sum = key => turns.reduce((n, e) => n + (e.usage[key] ?? 0), 0);
            tokens = { input: sum('input_tokens'), cacheRead: sum('cached_input_tokens'), output: sum('output_tokens'),
                total: sum('input_tokens') + sum('output_tokens'), cost: null,
                note: 'Codex input includes cached input; do not add cacheRead again.' };
        }
    } else {
        report = await fs.readFile(path.join(callDir, 'usage.json'), 'utf8').then(JSON.parse).catch(() => null);
        tokens = copilotUsage(report);
        models = Object.keys(report?.modelMetrics ?? {});
    }
    return { args, code: result.code, wallMs: Date.now() - started, raw, responseHash: hash(raw),
        report, tokens, models, stderr: result.stderr };
}

async function main() {
    const provider = flag('provider', 'claude');
    if (!['claude', 'codex', 'copilot'].includes(provider)) throw Error('Unknown provider.');
    const model = flag('model', provider === 'claude' ? 'sonnet' : '');
    const size = Number(flag('size', '8'));
    const trials = Number(flag('trials', '1'));
    const isolated = flag('isolated', 'false') === 'true';
    if (isolated && provider !== 'copilot') throw Error('Isolation experiment is currently Copilot-only.');
    if (!Number.isInteger(size) || size < 1 || size > 16 || !Number.isInteger(trials) || trials < 1) throw Error('Invalid size/trials.');
    const input = path.resolve(here, flag('input', 'results-cache-v083-isolated.json'));
    const output = path.resolve(here, flag('output', `results-batching-${provider}-${size}.json`));
    const bytes = await fs.readFile(input);
    const source = JSON.parse(bytes);
    const run = source.runs.find(r => r.arm === 'current' && r.trial === 1);
    const wanted = flag('files', '').split(',').filter(Boolean);
    const targets = source.config.targets.filter(t => !wanted.length || wanted.some(f => t.file.endsWith(f)));
    if (!targets.length) throw Error('No targets.');
    const entries = targets.map(target => {
        const saved = run.internal.filter(e => internalFile(e) === target.file);
        if (saved.length !== 1 || hash(saved[0].prompt) !== saved[0].promptHash) throw Error(`Invalid saved prompt: ${target.file}`);
        return { ...target, prompt: saved[0].prompt, promptHash: saved[0].promptHash };
    });
    const cli = which(provider);
    if (!cli) throw Error(`CLI not installed: ${provider}`);
    const version = (await runProcess({ file: cli, args: ['--version'] })).stdout.trim();
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'predictive-batching-'));
    const stage = path.join(work, 'source');
    await fs.mkdir(stage);
    for (const corpus of ['corpus', 'corpus-ts']) await fs.cp(path.join(here, corpus), path.join(stage, corpus), { recursive: true });
    for (const file of source.config.corpus) {
        if (hash(await fs.readFile(path.join(stage, file.file))) !== file.hash) throw Error(`Source changed: ${file.file}`);
    }
    const config = { provider, model: model || 'CLI default', version, size, trials, isolated, input: path.basename(input),
        inputHash: hash(bytes), runnerHash: hash(await fs.readFile(fileURLToPath(import.meta.url))),
        targets: entries.map(({ prompt, ...rest }) => rest),
        corpus: source.config.corpus,
        note: 'Development experiment of internal calls only. Same saved source/policy, fresh CLI calls. No release or end-to-end claim.' };
    const configHash = hash(JSON.stringify(config));
    let data;
    try { data = JSON.parse(await fs.readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (data && data.configHash !== configHash) throw Error('Configuration changed; use a new output.');
    if (data?.calls.some(c => c.error || c.code !== 0)) throw Error('Previous call failed; retain it and choose a new output for a retry.');
    data ??= { config, configHash, startedAt: new Date().toISOString(), status: 'running', calls: [] };
    for (let trial = 1; trial <= trials; trial++) {
        for (let start = 0; start < entries.length;) {
            const group = [];
            do { group.push(entries[start++]); }
            while (start < entries.length && group.length < size && batchPrompt([...group, entries[start]]).length <= 120_000);
            const id = `${trial}/${start - group.length}`;
            if (data.calls.some(c => c.id === id)) continue;
            const prompt = batchPrompt(group);
            const callDir = path.join(work, id.replace('/', '-'));
            await fs.mkdir(callDir);
            console.log(`${provider} ${id}: ${group.length} files, ${encode(prompt).length} estimated prompt tokens`);
            let result;
            try { result = await invoke(provider, cli, model, prompt, stage, callDir, isolated); }
            catch (error) { result = { error: String(error), raw: '', responseHash: hash(''), tokens: null }; }
            const assessments = parseBatch(result.raw, group.length);
            data.calls.push({ id, trial, files: group.map(e => e.file), prompt, promptHash: hash(prompt),
                estimatedPromptTokens: encode(prompt).length, ...result, assessments });
            await fs.writeFile(output, JSON.stringify(data, null, 2) + '\n');
            console.log(`  ${result.code ?? result.error}: total=${result.tokens?.total ?? 'unreported'}`);
            if (result.error || result.code !== 0) {
                data.status = 'interrupted';
                await fs.writeFile(output, JSON.stringify(data, null, 2) + '\n');
                process.exitCode = 1;
                return;
            }
        }
    }
    data.status = 'complete';
    data.completedAt = new Date().toISOString();
    await fs.writeFile(output, JSON.stringify(data, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
