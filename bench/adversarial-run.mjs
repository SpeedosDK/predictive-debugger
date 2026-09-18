/**
 * Runs the detector over the adversarial cases and scores every finding with Jev in the
 * same pass.
 *
 * One call per file produces both the CLI verdict and Jev's ranking from the same source
 * snapshot, which is the pairing the ranking question needs: a replay of saved verdicts
 * can drift from the code Jev is shown, and a separate Jev pass would re-read the file.
 *
 *   node bench/adversarial-run.mjs --env-file=.env
 *   node bench/adversarial-run.mjs --env-file=.env --no-jev   # detector only
 *
 * Findings on `controls` are false alarms; that is what these cases are for. Findings on
 * `bugs` are graded against the answer key by `adversarial-report.mjs`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { predictFiles } = require('../out/core/prediction/predictFiles.js');
const { createJevReviewer } = require('../out/core/prediction/jev.js');
const { ProviderRegistry } = require('../out/providers/registry.js');
const { createOpenRouterTransport } = await import('./jev-openrouter-transport.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const flag = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const has = name => process.argv.includes(`--${name}`);

const envFile = flag('env-file', '');
if (envFile) {
    for (const line of (await fs.readFile(path.resolve(envFile), 'utf8')).split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (match) process.env[match[1]] ??= match[2].trim();
    }
}

const model = flag('model', 'sonnet');
const providerId = flag('provider', 'claude');
const concurrency = Number(flag('concurrency', '4'));
const output = path.resolve(here, flag('output', 'results-adversarial.json'));
const useJev = !has('no-jev');

const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8'));
const cases = manifest.adversarial;
if (!cases) throw Error('manifest.json has no `adversarial` section; run node bench/generate-corpus.mjs first.');

const targets = [
    ...cases.bugs.map(bug => ({ ...bug, kind: 'buggy' })),
    ...cases.controls.map(file => ({ file, kind: 'clean' }))
];
for (const target of targets) {
    target.absolute = path.join(here, 'corpus', target.file);
    target.sourceHash = hash(await fs.readFile(target.absolute, 'utf8'));
}

let jev;
if (useJev) {
    const key = process.env.OPENROUTER_API_KEY ?? process.env.TYPESAFE_API_KEY;
    if (!key) throw Error('Set OPENROUTER_API_KEY or pass --env-file, or run with --no-jev.');
    jev = /^sk-or-/.test(key)
        ? createJevReviewer({ apiKey: key, request: createOpenRouterTransport() })
        : createJevReviewer({ apiKey: key });
}

const registry = new ProviderRegistry();
const active = await registry.resolveActive(providerId);
console.log(`Detector: ${active.provider.id} (${model}). Jev: ${useJev ? 'on' : 'off'}. ${targets.length} files.`);

const started = Date.now();
let done = 0;
const { results, failures } = await predictFiles(targets.map(t => t.absolute), {
    provider: active.provider, location: active.location, model, concurrency, jev,
    onProgress: (file) => console.log(`  [${++done}/${targets.length}] ${path.basename(file)}`)
});

const byPath = new Map(results.map(result => [path.resolve(result.file), result]));
const rows = targets.map(target => {
    const result = byPath.get(path.resolve(target.absolute));
    const top = result?.ai?.findings?.[0];
    return {
        file: target.file, kind: target.kind, sourceHash: target.sourceHash,
        expected: target.kind === 'buggy'
            ? { pattern: target.pattern, line: target.line, acceptableLines: target.acceptableLines,
                acceptableRanges: target.acceptableRanges, summary: target.summary }
            : null,
        detected: top ? { pattern: top.pattern, score: top.score, line: top.line, reason: top.reason } : null,
        combinedScore: result?.combinedScore ?? null,
        riskScore: result?.riskScore ?? null,
        jev: result?.jev ?? null
    };
});

const saved = {
    config: { model, provider: active.provider.id, concurrency, jev: useJev,
        manifestHash: hash(await fs.readFile(path.join(here, 'manifest.json'))),
        casesHash: hash(await fs.readFile(path.join(here, 'adversarial-cases.mjs'))),
        runnerHash: hash(await fs.readFile(fileURLToPath(import.meta.url))) },
    startedAt: new Date(started).toISOString(), wallMs: Date.now() - started,
    failures, rows
};
await fs.writeFile(output, JSON.stringify(saved, null, 2) + '\n');

const { report } = await import('./adversarial-report.mjs');
console.log('\n' + report(saved));
console.log(`Saved to ${path.relative(process.cwd(), output)}`);
if (failures.length) console.error(`${failures.length} file(s) failed: ${failures.map(f => f.reason).join('; ')}`);
