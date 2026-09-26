/**
 * Prediction-engine accuracy on the existing 37 targets, through the compiled engine and the
 * real CLIs. No caller agent: this isolates prompt and grouping changes from caller behavior.
 * Scoring is automatic: a bug counts when an actionable finding cites a line inside the answer
 * key's acceptable range; a control counts as a false alarm when any finding is actionable.
 * Reasons are saved so a line-range hit on the wrong defect can still be caught by reading.
 *
 *   node bench/engine-accuracy.mjs --provider=copilot --size=8 --trials=2 [--suite=dev|holdout|all] --output=results-engine-copilot.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { namesDiscoveredDefect, providerUsage } from './usage.mjs';

const require = createRequire(import.meta.url);
const { predictBugs } = require('../out/core/prediction/predictBug.js');
const { collectCalleeContext } = require('../out/core/analysis/callees.js');
const { hasReadAwaitWrite } = require('../out/core/analysis/staleWrite.js');
const { MIN_ACTIONABLE_SCORE } = require('../out/core/prediction/confidence.js');
const { ProviderRegistry } = require('../out/providers/registry.js');
const { which } = require('../out/providers/locate.js');
const { runProcess } = require('../out/providers/processRunner.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const flag = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

export function score(targets, verdicts) {
    const rows = targets.map(target => {
        const findings = verdicts[target.file] ?? [];
        const actionable = findings.filter(f => f.score >= MIN_ACTIONABLE_SCORE);
        const unavailable = findings.length === 0 || findings[0].pattern === 'unknown';
        const hit = target.kind === 'buggy' && actionable.some(f => f.line !== undefined &&
            target.acceptableRanges.some(([start, end]) => f.line >= start && f.line <= end));
        const otherVerified = !hit && actionable.some(f => namesDiscoveredDefect(target.file, f.line));
        return { file: target.file, kind: target.kind, unavailable, hit, otherVerified,
            falseAlarm: target.kind !== 'buggy' && actionable.length > 0 && !otherVerified, top: findings[0] };
    });
    return {
        bugs: rows.filter(r => r.kind === 'buggy').length,
        detected: rows.filter(r => r.hit).length,
        controls: rows.filter(r => r.kind !== 'buggy').length,
        falseAlarms: rows.filter(r => r.falseAlarm).length,
        unavailable: rows.filter(r => r.unavailable).length,
        otherVerified: rows.filter(r => r.otherVerified).length,
        rows
    };
}

async function main() {
    const provider = flag('provider', 'copilot');
    const model = flag('model', undefined);
    const size = Number(flag('size', '8'));
    const trials = Number(flag('trials', '1'));
    const concurrency = Number(flag('concurrency', '4'));
    const output = path.join(here, 'results', flag('output', `results-engine-${provider}-${size}.json`));
    if (!['claude', 'codex', 'copilot'].includes(provider) || !(size >= 1) || !(trials >= 1)) throw Error('Invalid options.');

    const record = JSON.parse(await fs.readFile(path.join(here, 'results', 'results-cache-v083-isolated.json'), 'utf8'));
    const work = path.join(os.tmpdir(), `predictive-engine-${provider}`);
    const stage = path.join(work, 'source');
    await fs.rm(stage, { recursive: true, force: true });
    for (const corpus of ['corpus', 'corpus-ts']) await fs.cp(path.join(here, corpus), path.join(stage, corpus), { recursive: true });
    for (const file of record.config.corpus) {
        if (hash(await fs.readFile(path.join(stage, file.file))) !== file.hash) throw Error(`Source changed: ${file.file}`);
    }
    const suite = flag('suite', 'dev');
    const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8'));
    const holdout = [
        ...manifest.holdout.bugs.map(bug => ({ ...bug, file: `corpus/${bug.file}`, kind: 'buggy', suite: 'holdout' })),
        ...manifest.holdout.controls.map(file => ({ file: `corpus/${file}`, kind: 'clean', suite: 'holdout' }))
    ];
    const targets = { dev: record.config.targets, holdout, all: [...record.config.targets, ...holdout] }[suite];
    if (!targets) throw Error('--suite must be dev, holdout or all.');

    const cli = which(provider);
    if (!cli) throw Error(`Missing ${provider}`);
    const shim = path.join(work, 'shim');
    await fs.mkdir(shim, { recursive: true });
    if (process.platform !== 'win32') throw Error('The capture shim currently requires Windows.');
    const shimFile = path.join(shim, `${provider}.cmd`);
    await fs.writeFile(shimFile, `@"${process.execPath}" "${path.join(here, 'capture-provider.cjs')}" ${provider} %*\r\n`);
    process.env[`BENCH_REAL_${provider.toUpperCase()}`] = cli;
    delete process.env.CLAUDECODE;

    const config = { provider, model: model ?? null, size, concurrency, trials, suite, targets: targets.map(t => t.file),
        version: (await runProcess({ file: cli, args: ['--version'] })).stdout.trim(),
        engineHash: hash(await fs.readFile(path.join(here, '../out/core/prediction/predictBug.js'))),
        runnerHash: hash(await fs.readFile(fileURLToPath(import.meta.url))) };
    const data = { config, startedAt: new Date().toISOString(), runs: [] };
    const impl = new ProviderRegistry().get(provider);

    for (let trial = 1; trial <= trials; trial++) {
        // Rotate the order so each trial puts files in different groups.
        const offset = ((trial - 1) * 11) % targets.length;
        const ordered = [...targets.slice(offset), ...targets.slice(0, offset)];
        const usageDir = path.join(work, `usage-${trial}-${Date.now()}`);
        await fs.mkdir(usageDir);
        process.env.BENCH_USAGE_DIR = usageDir;
        const inputs = await Promise.all(ordered.map(async target => {
            const filePath = path.join(stage, target.file);
            const code = await fs.readFile(filePath, 'utf8');
            return { filePath, code, callees: await collectCalleeContext(filePath, code), recheckIfClean: await hasReadAwaitWrite(code) };
        }));
        const started = Date.now();
        const outcomes = await predictBugs(inputs, { provider: impl, location: { file: shimFile }, model,
            concurrency, maxBatchFiles: size, cache: false });
        const verdicts = {}, failures = {};
        outcomes.forEach((outcome, i) => {
            if (outcome.kind === 'assessment') verdicts[ordered[i].file] = outcome.assessment.findings;
            else failures[ordered[i].file] = outcome.kind === 'failure' ? outcome.reason : 'cancelled';
        });
        const calls = [];
        for (const file of await fs.readdir(usageDir)) if (file.endsWith('.json')) {
            calls.push(JSON.parse(await fs.readFile(path.join(usageDir, file), 'utf8')));
        }
        const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 };
        for (const call of calls) {
            try {
                const u = providerUsage(provider, call.report);
                for (const key of Object.keys(usage)) usage[key] += u[key] ?? 0;
            } catch { usage.missing = (usage.missing ?? 0) + 1; }
        }
        const result = score(targets, verdicts);
        data.runs.push({ trial, wallMs: Date.now() - started, calls: calls.length, usage, failures,
            ...result, raw: calls.map(c => ({ prompt: c.prompt, response: c.response, code: c.code })) });
        await fs.writeFile(output, JSON.stringify(data, null, 2) + '\n');
        console.log(`trial ${trial}: ${result.detected}/${result.bugs} detected, ${result.falseAlarms}/${result.controls} ` +
            `false alarms, ${result.unavailable} unavailable, ${calls.length} calls, ${usage.total} tokens`);
        for (const row of result.rows) {
            const bad = (row.kind === 'buggy' && !row.hit) || row.falseAlarm || row.unavailable;
            if (bad) console.log(`  ${row.kind === 'buggy' ? 'MISS' : 'FA  '} ${row.file} ${row.top?.score ?? '-'} ` +
                `${row.top?.pattern ?? '-'} L${row.top?.line ?? '-'} ${(row.top?.reason ?? failures[row.file] ?? '').slice(0, 150)}`);
        }
    }
    data.completedAt = new Date().toISOString();
    await fs.writeFile(output, JSON.stringify(data, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
