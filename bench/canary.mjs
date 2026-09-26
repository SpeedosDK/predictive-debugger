/**
 * Drift check after a CLI or model update: one grouped run of the shipped pipeline on the
 * 12 held-out files, compared with thresholds measured on September 26, 2026 (Claude 2.1.283,
 * Codex 0.157.1, Copilot 1.0.82: 6-7 of 7 bugs, no false alarms; see ENGINE-ACCURACY.md).
 * Appends every run to canary-log.jsonl so a drop can be tied to the version that caused it.
 *
 *   npm run compile && node bench/canary.mjs --provider=claude [--model=sonnet]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const flag = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const provider = flag('provider', 'claude');
const model = flag('model', { claude: 'sonnet', codex: undefined, copilot: 'claude-sonnet-5' }[provider]);
const MIN_DETECTED = 6;
// Internal tokens for the 12 files on the measured versions; well above this means the CLI
// started sending more context per call.
const TOKEN_CEILING = { claude: 60_000, codex: 90_000, copilot: 400_000 }[provider];

const output = `canary-${provider}-${Date.now()}.json`;
const args = [path.join(here, 'engine-accuracy.mjs'), `--provider=${provider}`, '--suite=holdout', '--size=8',
    '--trials=1', `--output=${output}`, ...(model ? [`--model=${model}`] : [])];
const run = spawnSync(process.execPath, args, { stdio: 'inherit' });
const file = path.join(here, 'results', output);
const data = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null'));
await fs.rm(file, { force: true });
if (run.status !== 0 || !data?.runs?.[0]) {
    console.error('Canary could not run; see the output above.');
    process.exit(2);
}

const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8')).holdout;
const bugs = new Map(manifest.bugs.map(bug => [`corpus/${bug.file}`, bug]));
const controls = new Set(manifest.controls.map(c => `corpus/${c}`));
const row = data.runs[0];
let detected = 0, falseAlarms = 0;
for (const r of row.rows) {
    const top = r.top;
    if (!top || top.score < 0.7) continue;
    const bug = bugs.get(r.file);
    if (bug && top.line !== undefined && bug.acceptableRanges.some(([s, e]) => top.line >= s && top.line <= e)) detected++;
    if (controls.has(r.file)) falseAlarms++;
}
const problems = [
    detected < MIN_DETECTED && `detected ${detected}/${bugs.size}, expected at least ${MIN_DETECTED}`,
    falseAlarms > 0 && `${falseAlarms} false alarm(s) on ${controls.size} clean files`,
    row.unavailable > 0 && `${row.unavailable} unavailable verdict(s): the reply format may have changed`,
    row.usage.total > TOKEN_CEILING && `${row.usage.total} tokens, above the ${TOKEN_CEILING} ceiling`
].filter(Boolean);
const entry = { at: new Date().toISOString(), provider, model: model ?? null, version: data.config.version.split('\n')[0],
    detected, bugs: bugs.size, falseAlarms, controls: controls.size, unavailable: row.unavailable,
    tokens: row.usage.total, calls: row.calls, wallMs: row.wallMs, status: problems.length ? 'drift' : 'pass', problems };
await fs.appendFile(path.join(here, 'results', 'canary-log.jsonl'), JSON.stringify(entry) + '\n');
console.log(`\n${entry.status.toUpperCase()}: ${provider} ${entry.version} - ${detected}/${bugs.size} bugs, ` +
    `${falseAlarms}/${controls.size} false alarms, ${entry.tokens} tokens, ${Math.round(entry.wallMs / 1000)}s`);
for (const problem of problems) console.log(`  - ${problem}`);
process.exit(problems.length ? 1 : 0);
