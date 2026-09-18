/**
 * Does Jev's evidence score separate correct findings from false alarms?
 *
 * Jev cannot change what `predict_failures` detects -- it attaches a ranking and leaves
 * `score`, `combinedScore`, `actionable` and finding order alone -- so a detection-rate
 * rerun of `workflows.mjs` would return the same counts twice and bill for both. The
 * measurable question is whether its rubric scores order true findings above wrong ones.
 *
 * This replays findings already recorded in `results-v072-full.json` instead of running
 * fresh sessions: the CLI verdicts and their hash-bound judgments are the ground truth,
 * so no CLI tokens are spent and only Jev varies between this experiment and that one.
 *
 *   node bench/jev-discrimination.mjs --dry-run             # simulated transport, no key, no spend
 *   node bench/jev-discrimination.mjs --scorer=openrouter   # Jev through OpenRouter (the reachable path)
 *   node bench/jev-discrimination.mjs --scorer=jev          # Jev through Typesafe directly (invite-only)
 *
 * The key is read from the environment only. `--env-file=.env` loads one locally for a
 * manual run; never commit a key or pass one as an argument.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { internalFile } from './workflow-summary.mjs';

const require = createRequire(import.meta.url);
const { createJevReviewer } = require('../out/core/prediction/jev.js');
const { parseAssessment } = require('../out/core/prediction/predictBug.js');
const { collectCalleeContext } = require('../out/core/analysis/callees.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const flag = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const has = name => process.argv.includes(`--${name}`);

const dryRun = has('dry-run');
/*
 * Both run the shipped reviewer; they differ only in how it reaches the model.
 *   jev        - Typesafe's own API, which is invite-only.
 *   openrouter - the same model resold by OpenRouter. This is the reachable path.
 */
const scorer = dryRun ? 'dry-run' : flag('scorer', 'openrouter');
if (!['jev', 'openrouter', 'dry-run'].includes(scorer)) throw Error(`Unknown --scorer=${scorer}`);
const defaultOutput = { 'dry-run': 'results-jev-dryrun.json', jev: 'results-jev-typesafe.json',
    openrouter: 'results-jev-openrouter.json' }[scorer];
const source = path.resolve(here, flag('source', 'results-v072-full.json'));
const judgmentFile = path.resolve(here, flag('judgments', 'judgments-v072-full.json'));
const output = path.resolve(here, flag('output', defaultOutput));
const limit = Number(flag('limit', '0'));

const envFile = flag('env-file', '');
if (envFile) {
    for (const line of (await fs.readFile(path.resolve(envFile), 'utf8')).split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (match) process.env[match[1]] ??= match[2].trim();
    }
}

const data = JSON.parse(await fs.readFile(source, 'utf8'));
const judgments = JSON.parse(await fs.readFile(judgmentFile, 'utf8'));
if (data.status !== 'complete') throw Error(`Source experiment is ${data.status}; refusing to replay partial runs.`);
const targets = Object.fromEntries(data.config.targets.map(target => [target.file, target]));

/**
 * The corpus in the working tree must be byte-identical to what produced the saved verdicts.
 * Jev is asked about a finding against source; scoring it against drifted source measures nothing.
 */
const corpusRoot = { corpus: path.join(here, 'corpus'), 'corpus-ts': path.join(here, 'corpus-ts') };
async function readTargetSource(file) {
    const [root, ...rest] = file.split('/');
    const absolute = path.join(corpusRoot[root], ...rest);
    const code = await fs.readFile(absolute, 'utf8');
    if (hash(code) !== targets[file].sourceHash) throw Error(`Corpus drift: ${file} no longer matches the recorded sourceHash.`);
    return { absolute, code };
}

/**
 * Ground truth per replayed finding.
 *
 * `judged` records came through the agent as a defect and carry a hash-bound judgment, so
 * they are the primary pool. A finding the tool produced but scored below the actionable
 * cut never reached a reviewer; it is labelled from the answer key alone and kept in a
 * separate stratum, because "the corpus says this file is clean" is weaker evidence about
 * one finding than a reviewer who read it.
 */
function label(run, file, verdictReported) {
    const target = targets[file];
    const judgment = judgments[`${run.id}/${file}`];
    if (verdictReported && judgment) {
        if (judgment.sourceHash !== target.sourceHash || judgment.promptHash !== run.promptHash ||
            judgment.responseHash !== run.responseHash) throw Error(`Stale judgment: ${run.id}/${file}`);
        const correct = target.kind === 'buggy'
            ? Boolean(judgment.matchesDefect || judgment.validDefect)
            : judgment.validDefect === true;
        return { stratum: 'judged', correct, basis: judgment.reason ?? 'hash-bound judgment' };
    }
    return { stratum: 'below-cut', correct: target.kind === 'buggy',
        basis: 'answer key only; finding did not reach the actionable cut' };
}

const pool = [];
for (const run of data.runs.filter(row => row.arm === 'previous' || row.arm === 'current')) {
    for (const inner of run.internal) {
        const file = internalFile(inner);
        if (!targets[file]) continue;
        const assessment = parseAssessment(inner.report.result ?? '');
        const top = assessment.findings[0];
        if (!top || top.pattern === 'none' || top.pattern === 'unknown') continue;
        const reported = run.verdicts.find(verdict => verdict.file === file)?.defect === true;
        pool.push({ id: `${run.id}/${file}`, arm: run.arm, trial: run.trial, file,
            kind: targets[file].kind, pattern: top.pattern, line: top.line, cliScore: top.score,
            assessment, ...label(run, file, reported) });
    }
}
pool.sort((a, b) => a.id.localeCompare(b.id));
const selected = limit > 0 ? pool.slice(0, limit) : pool;

const mode = { 'dry-run': 'simulated transport', jev: 'Jev via Typesafe API',
    openrouter: 'Jev via OpenRouter (typesafe/jev-1.13)' }[scorer];
const config = {
    source: path.basename(source), sourceHash: hash(await fs.readFile(source)),
    judgments: path.basename(judgmentFile), judgmentsHash: hash(await fs.readFile(judgmentFile)),
    scorer, mode,
    records: selected.length, limit: limit || null,
    runnerHash: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    jevHash: hash(await fs.readFile(path.join(here, '../out/core/prediction/jev.js')))
};
const configHash = hash(JSON.stringify(config));

let saved;
try { saved = JSON.parse(await fs.readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (saved && saved.configHash !== configHash) throw Error('Configuration changed; choose a separate --output.');
saved ??= { config, configHash, startedAt: new Date().toISOString(), status: 'running', scored: [] };

/**
 * A deterministic stand-in for the paid service so the harness, labelling and report can be
 * exercised without a key. It answers from the CLI's own score, which makes the dry run a
 * check that the plumbing works -- never a result about Jev.
 */
function simulatedTransport() {
    return async (url, init) => {
        const body = JSON.parse(init.body);
        const answers = Object.fromEntries(Object.keys(body.questions).map(id => {
            const level = Math.max(0, Math.min(4, Math.round((body.state.findings[0]?.reason?.length ?? 0) % 5)));
            const probabilities = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 };
            probabilities[String(level)] = 1;
            return [id, { type: 'score', score: level, confidence: 0.5, probabilities }];
        }));
        return Response.json({ model: 'jev-1.13.0', answers,
            usage: { input_tokens: Math.ceil(init.body.length / 4), output_tokens: 12 * Object.keys(answers).length } });
    };
}

let review;
if (scorer === 'dry-run') {
    review = createJevReviewer({ apiKey: 'dry-run-fixture-key', request: simulatedTransport() });
} else if (scorer === 'jev') {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw Error('TYPESAFE_API_KEY is not set. Use --dry-run to exercise the harness without it.');
    if (/^sk-or-/.test(apiKey)) {
        throw Error('This is an OpenRouter key, and --scorer=jev calls Typesafe directly. ' +
            'Use --scorer=openrouter to reach the same model through OpenRouter.');
    }
    review = createJevReviewer({ apiKey });
} else {
    // Both OpenRouter arms authenticate the same way; the key often lands in TYPESAFE_API_KEY
    // because that is the variable docs/jev.md names.
    const candidate = process.env.OPENROUTER_API_KEY ?? process.env.TYPESAFE_API_KEY;
    if (!candidate) throw Error(`Set OPENROUTER_API_KEY (or pass --env-file) for --scorer=${scorer}.`);
    if (!/^sk-or-/.test(candidate)) throw Error(`--scorer=${scorer} needs an OpenRouter key (sk-or-...).`);
    const { createOpenRouterTransport } = await import('./jev-openrouter-transport.mjs');
    review = createJevReviewer({ apiKey: candidate, request: createOpenRouterTransport() });
}

async function checkpoint() {
    await fs.writeFile(`${output}.tmp`, JSON.stringify(saved, null, 2) + '\n');
    await fs.rename(`${output}.tmp`, output);
}

let consecutiveFailures = 0;
console.log(`Replaying ${selected.length} findings through Jev (${config.mode}).`);
for (const record of selected) {
    if (saved.scored.some(row => row.id === record.id)) continue;
    const { absolute, code } = await readTargetSource(record.file);
    const callees = await collectCalleeContext(absolute, code);
    const started = Date.now();
    const jev = await review({ code, callees, assessment: record.assessment });
    const top = jev.status === 'scored' ? jev.findings[0] : null;
    saved.scored.push({ id: record.id, arm: record.arm, trial: record.trial, file: record.file,
        kind: record.kind, stratum: record.stratum, correct: record.correct, basis: record.basis,
        pattern: record.pattern, line: record.line, cliScore: record.cliScore,
        status: jev.status, reason: jev.reason ?? null, wallMs: Date.now() - started,
        evidence: top?.evidence ?? null, impact: top?.impact ?? null, priority: top?.priority ?? null,
        usage: jev.usage ?? null, truncated: jev.truncated ?? null, calleeCount: callees.length });
    await checkpoint();
    const shown = top ? `evidence ${top.evidence.score.toFixed(2)} impact ${top.impact.score.toFixed(2)}` : jev.reason;
    console.log(`  ${record.correct ? 'true ' : 'FALSE'} ${record.file} -> ${jev.status} ${shown}`);

    // Credentials, credit and quota fail identically on every record. Three in a row is the
    // service being down for this run, not a hard finding, so stop rather than walk the
    // remaining hundred and bury the cause under a wall of identical lines.
    consecutiveFailures = jev.status === 'unavailable' ? consecutiveFailures + 1 : 0;
    if (consecutiveFailures >= 3 || (jev.status === 'unavailable' &&
        ['authentication', 'invalid-key', 'not-configured'].includes(jev.reason))) {
        saved.status = 'blocked';
        await checkpoint();
        throw Error(`Stopping: ${consecutiveFailures} consecutive unavailable results (last reason: ${jev.reason}). ` +
            'Resolve the cause and rerun; completed records resume from the saved file.');
    }
}
saved.status = 'complete';
saved.updatedAt = new Date().toISOString();
await checkpoint();

const { report } = await import('./jev-report.mjs');
console.log('\n' + report(saved));
console.log(`Saved ${saved.scored.length} scored findings to ${path.relative(process.cwd(), output)}`);
