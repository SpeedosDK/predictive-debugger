/**
 * Grades the adversarial run and measures how well Jev ranks what the detector produced.
 *
 *   node bench/adversarial-report.mjs [--input=results-adversarial.json]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auc } from './jev-report.mjs';

/** Matches the threshold the MCP server uses to decide what reaches a caller as actionable. */
const ACTIONABLE = 0.7;

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = n => n.toLocaleString('en-US');

/**
 * A finding exists when the model named a pattern other than none/unknown. Whether it is
 * *reported* is a separate question the threshold answers, so both are counted: a scorer
 * that only ever sees actionable findings is being asked an easier question than the one
 * a user experiences.
 */
export function classify(row) {
    const finding = row.detected && row.detected.pattern !== 'none' && row.detected.pattern !== 'unknown'
        ? row.detected : null;
    if (!finding) return { finding: null, actionable: false, correct: null };
    const actionable = (row.combinedScore ?? finding.score) >= ACTIONABLE;
    if (row.kind === 'clean') return { finding, actionable, correct: false };
    const ranges = row.expected?.acceptableRanges ?? [];
    const lines = row.expected?.acceptableLines ?? [];
    const located = finding.line === undefined || finding.line === null ? false
        : lines.includes(finding.line) || ranges.some(([start, end]) => finding.line >= start && finding.line <= end);
    return { finding, actionable, correct: located };
}

export function report(saved) {
    const lines = [];
    const rows = saved.rows.map(row => ({ ...row, ...classify(row) }));
    const controls = rows.filter(row => row.kind === 'clean');
    const bugs = rows.filter(row => row.kind === 'buggy');

    const falseAlarms = controls.filter(row => row.finding);
    const reportedFalseAlarms = falseAlarms.filter(row => row.actionable);
    const found = bugs.filter(row => row.correct);
    const mislocated = bugs.filter(row => row.finding && !row.correct);

    lines.push('# Adversarial cases', '');
    lines.push(`Detector: ${saved.config.provider} (${saved.config.model}). Jev: ${saved.config.jev ? 'on' : 'off'}. ` +
        `${rows.length} files in ${Math.round(saved.wallMs / 1000)}s.`, '');

    lines.push('## What the detector did', '');
    lines.push('| | n | result |');
    lines.push('|---|---:|---|');
    lines.push(`| Planted bugs found at the right place | ${found.length}/${bugs.length} | ` +
        `${bugs.length - found.length} missed${mislocated.length ? `, ${mislocated.length} pointed elsewhere` : ''} |`);
    lines.push(`| Controls that drew a finding | ${falseAlarms.length}/${controls.length} | ` +
        `${reportedFalseAlarms.length} above the ${ACTIONABLE} actionable cut |`);
    lines.push('');

    if (falseAlarms.length) {
        lines.push('False alarms (the negative class this corpus exists to create):', '');
        for (const row of falseAlarms) {
            lines.push(`- \`${path.basename(row.file)}\` — ${row.finding.pattern} at line ${row.finding.line}, ` +
                `score ${row.finding.score?.toFixed(2)}${row.actionable ? ' **(reported)**' : ' (below cut)'}`);
        }
        lines.push('');
    }
    if (bugs.length - found.length) {
        lines.push('Missed or mislocated bugs:', '');
        for (const row of bugs.filter(r => !r.correct)) {
            lines.push(`- \`${path.basename(row.file)}\` — ${row.finding
                ? `reported ${row.finding.pattern} at line ${row.finding.line}, expected line ${row.expected.line}`
                : 'no finding'}`);
        }
        lines.push('');
    }

    const scored = rows.filter(row => row.finding && row.jev?.status === 'scored');
    if (!scored.length) {
        lines.push('## Jev', '', 'No finding was scored; nothing to rank.');
        return lines.join('\n');
    }

    const value = (row, key) => row.jev.findings[0]?.[key];
    const positive = scored.filter(row => row.correct);
    const negative = scored.filter(row => !row.correct);

    lines.push('## How Jev ranked them', '');
    lines.push(`${scored.length} findings scored: ${positive.length} correct, ${negative.length} wrong.`, '');
    lines.push('| Group | n | evidence | impact | priority |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const [name, group] of [['Correct', positive], ['Wrong', negative]]) {
        if (!group.length) { lines.push(`| ${name} | 0 | — | — | — |`); continue; }
        lines.push(`| ${name} | ${group.length} | ${mean(group.map(r => value(r, 'evidence').score)).toFixed(2)} | ` +
            `${mean(group.map(r => value(r, 'impact').score)).toFixed(2)} | ` +
            `${mean(group.map(r => value(r, 'priority'))).toFixed(2)} |`);
    }
    lines.push('');

    const evidenceAuc = auc(positive.map(r => value(r, 'evidence').score), negative.map(r => value(r, 'evidence').score));
    if (evidenceAuc === null) {
        lines.push(`No separation measurable: the ${positive.length ? 'wrong' : 'correct'} group is empty.`, '');
    } else {
        const priorityAuc = auc(positive.map(r => value(r, 'priority')), negative.map(r => value(r, 'priority')));
        lines.push(`Evidence AUC ${evidenceAuc.toFixed(3)}, priority AUC ${priorityAuc.toFixed(3)} (0.5 = no separation).`, '');

        /*
         * The practical question behind the AUC: could an evidence cut have suppressed the
         * false alarms without discarding correct findings? Reported at the best achievable
         * threshold, which is fitted on this data and so is an upper bound, not a setting.
         */
        const cuts = [...new Set(scored.map(r => value(r, 'evidence').score))].sort((a, b) => a - b);
        let best = null;
        for (const cut of cuts) {
            const kept = positive.filter(r => value(r, 'evidence').score >= cut).length;
            const suppressed = negative.filter(r => value(r, 'evidence').score < cut).length;
            if (!best || kept + suppressed > best.kept + best.suppressed) best = { cut, kept, suppressed };
        }
        if (best) {
            lines.push(`Best evidence cut on this data: ${best.cut.toFixed(2)} keeps ${best.kept}/${positive.length} ` +
                `correct findings and suppresses ${best.suppressed}/${negative.length} wrong ones. ` +
                'Fitted on these cases, so it is an upper bound rather than a threshold to ship.', '');
        }
        if (negative.length < 10) {
            lines.push(`**Only ${negative.length} wrong finding${negative.length === 1 ? '' : 's'}.** ` +
                'Directional, not a measurement.', '');
        }
    }

    const usage = scored.reduce((acc, row) => ({
        input: acc.input + (row.jev.usage?.inputTokens ?? 0),
        output: acc.output + (row.jev.usage?.outputTokens ?? 0) }), { input: 0, output: 0 });
    const skipped = rows.filter(row => row.jev && row.jev.status !== 'scored');
    lines.push('## Jev cost', '');
    lines.push(`${scored.length} paid requests, ${fmt(usage.input)} input and ${fmt(usage.output)} output tokens.`);
    if (skipped.length) {
        const reasons = {};
        for (const row of skipped) reasons[`${row.jev.status}:${row.jev.reason}`] = (reasons[`${row.jev.status}:${row.jev.reason}`] ?? 0) + 1;
        lines.push(`Not scored: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
    }
    return lines.join('\n');
}

if (process.argv[1]?.endsWith('adversarial-report.mjs')) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const input = path.resolve(here, process.argv.find(a => a.startsWith('--input='))?.slice(8) ?? 'results-adversarial.json');
    console.log(report(JSON.parse(await fs.readFile(input, 'utf8'))));
}
