/**
 * Automatic scoring for cli-workflows.mjs results, for runs without hash-bound manual judgments.
 * A bug counts when the caller's final verdict says defect on a line inside the answer key's
 * acceptable range; a control counts as a false alarm when the verdict says defect at all.
 * Tokens are the caller's plus every captured internal call, each cache category counted once.
 *
 *   node bench/workflow-accuracy.mjs results-workflow-recheck-claude.json [...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerUsage } from './workflow-batching-summary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sum = (a, b) => Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'total'].map(k => [k, (a[k] ?? 0) + (b[k] ?? 0)]));
const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 };

export function scoreWorkflow(config, run) {
    const row = { arm: run.arm, trial: run.trial, failed: run.failed, detected: 0, falseAlarms: 0, missing: 0,
        bugs: 0, controls: 0, misses: [], alarms: [], calls: run.internal.length };
    for (const target of config.targets) {
        const verdict = (run.verdicts ?? []).find(v => v.file === target.file);
        if (target.kind === 'buggy') row.bugs++; else row.controls++;
        if (!verdict || typeof verdict.defect !== 'boolean') { row.missing++; continue; }
        if (target.kind === 'buggy') {
            const hit = verdict.defect && typeof verdict.line === 'number' &&
                target.acceptableRanges.some(([s, e]) => verdict.line >= s && verdict.line <= e);
            if (hit) row.detected++; else row.misses.push(`${target.file} ${verdict.defect ? `L${verdict.line}` : 'none'}`);
        } else if (verdict.defect) {
            row.falseAlarms++;
            row.alarms.push(`${target.file} L${verdict.line}: ${String(verdict.reason).slice(0, 120)}`);
        }
    }
    row.caller = providerUsage(config.provider, run.report);
    row.internal = run.internal.reduce((acc, call) => sum(acc, providerUsage(config.provider, call.report)), zero);
    row.tokens = sum(row.caller, row.internal);
    return row;
}

async function main() {
    for (const file of process.argv.slice(2)) {
        const data = JSON.parse(await fs.readFile(path.resolve(here, file), 'utf8'));
        console.log(`## ${file} (${data.config.provider} ${data.config.version.split('\n')[0]}, ${data.status})`);
        for (const run of data.runs) {
            const r = scoreWorkflow(data.config, run);
            console.log(`${r.arm.padEnd(8)} #${r.trial} ${r.detected}/${r.bugs} detected, ${r.falseAlarms}/${r.controls} false alarms, ` +
                `${r.missing} missing | caller ${r.caller.total} + internal ${r.internal.total} (${r.calls} calls) = ${r.tokens.total} tokens`);
            for (const m of r.misses) console.log(`    miss ${m}`);
            for (const a of r.alarms) console.log(`    FA   ${a}`);
        }
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
