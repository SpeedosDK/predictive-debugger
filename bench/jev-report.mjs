/**
 * Renders the Jev discrimination replay. Separated from the runner so a completed
 * result can be re-reported without touching the paid service.
 *
 *   node bench/jev-report.mjs [--input=results-jev-discrimination.json]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fmt = n => n.toLocaleString('en-US');
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Mann-Whitney AUC: the chance a random correct finding outranks a random wrong one,
 * with ties counted as half. 0.5 is no separation. Rank-based rather than pairwise so
 * the tie handling stays right when many findings share a rubric level -- Jev returns
 * five discrete levels, so ties are the normal case, not an edge case.
 */
export function auc(positive, negative) {
    if (!positive.length || !negative.length) return null;
    const all = [...positive.map(v => ({ v, pos: true })), ...negative.map(v => ({ v, pos: false }))]
        .sort((a, b) => a.v - b.v);
    let i = 0;
    const ranks = new Array(all.length);
    while (i < all.length) {
        let j = i;
        while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
        const shared = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[k] = shared;
        i = j + 1;
    }
    const positiveRankSum = all.reduce((sum, row, index) => sum + (row.pos ? ranks[index] : 0), 0);
    return (positiveRankSum - positive.length * (positive.length + 1) / 2) / (positive.length * negative.length);
}

function distribution(rows, pick) {
    const values = rows.map(pick).filter(v => v !== null && v !== undefined);
    if (!values.length) return 'n/a';
    const sorted = [...values].sort((a, b) => a - b);
    return `mean ${mean(values).toFixed(2)}  median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}  ` +
        `min ${sorted[0].toFixed(2)}  max ${sorted.at(-1).toFixed(2)}`;
}

export function report(saved) {
    const lines = [];
    const all = saved.scored;
    const scored = all.filter(row => row.status === 'scored');
    const byStatus = {};
    for (const row of all) byStatus[row.reason ? `${row.status}:${row.reason}` : row.status] =
        (byStatus[row.reason ? `${row.status}:${row.reason}` : row.status] ?? 0) + 1;

    lines.push(`# Jev discrimination replay`, '');
    lines.push(`Mode: ${saved.config.mode}. Source: ${saved.config.source} (${saved.config.sourceHash.slice(0, 12)}).`);
    lines.push(`Jev bundle: ${saved.config.jevHash.slice(0, 12)}. Status: ${saved.status}.`, '');
    lines.push(`${all.length} findings replayed; ${scored.length} returned a score.`);
    lines.push('Outcomes: ' + Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', '), '');

    for (const stratum of ['judged', 'below-cut']) {
        const rows = scored.filter(row => row.stratum === stratum);
        if (!rows.length) continue;
        const positive = rows.filter(row => row.correct);
        const negative = rows.filter(row => !row.correct);
        lines.push(`## ${stratum === 'judged' ? 'Reviewer-judged findings' : 'Findings below the actionable cut (answer key only)'}`, '');
        lines.push(`Correct findings: ${positive.length}. Wrong findings: ${negative.length}.`, '');
        lines.push('| Group | n | evidence score | impact score | priority |');
        lines.push('|---|---:|---|---|---|');
        for (const [name, group] of [['Correct', positive], ['Wrong', negative]]) {
            if (!group.length) { lines.push(`| ${name} | 0 | — | — | — |`); continue; }
            lines.push(`| ${name} | ${group.length} | ${distribution(group, r => r.evidence?.score)} | ` +
                `${distribution(group, r => r.impact?.score)} | ${distribution(group, r => r.priority)} |`);
        }
        lines.push('');
        const evidenceAuc = auc(positive.map(r => r.evidence?.score), negative.map(r => r.evidence?.score));
        const priorityAuc = auc(positive.map(r => r.priority), negative.map(r => r.priority));
        if (evidenceAuc === null) {
            lines.push(`No separation measurable: the ${positive.length ? 'wrong' : 'correct'} group is empty.`, '');
        } else {
            /*
             * Against the free baseline, not against chance. "Not using Jev" does not mean
             * presenting findings unordered -- it means ordering them by the score the tool
             * already produces at no extra cost. Jev only earns its call by beating that.
             */
            const baseline = auc(positive.map(r => r.cliScore), negative.map(r => r.cliScore));
            const blended = auc(positive.map(r => r.cliScore * r.priority), negative.map(r => r.cliScore * r.priority));
            lines.push('| Ranking signal | AUC |', '|---|---:|');
            lines.push(`| Tool score (free, this is "no Jev") | ${baseline.toFixed(3)} |`);
            lines.push(`| Jev evidence | ${evidenceAuc.toFixed(3)} |`);
            lines.push(`| Jev impact | ${auc(positive.map(r => r.impact?.score), negative.map(r => r.impact?.score)).toFixed(3)} |`);
            lines.push(`| Jev priority | ${priorityAuc.toFixed(3)} |`);
            lines.push(`| Tool score x Jev priority | ${blended.toFixed(3)} |`);
            lines.push('', '0.5 is no separation.',
                priorityAuc > baseline
                    ? `Jev's ranking beats the free baseline by ${(priorityAuc - baseline).toFixed(3)}.`
                    : `**The free baseline beats Jev by ${(baseline - priorityAuc).toFixed(3)}.** On this data Jev's ` +
                      'ranking does not justify its call.', '');
            if (negative.length < 10) {
                lines.push(`**${negative.length} wrong finding${negative.length === 1 ? '' : 's'} cannot support a ` +
                    `confident claim.** One reclassification moves this AUC by roughly ` +
                    `${(1 / negative.length).toFixed(2)}. Treat it as a direction to check, not a measurement.`, '');
            }
        }
    }

    const usage = scored.reduce((acc, row) => ({
        input: acc.input + (row.usage?.inputTokens ?? 0),
        output: acc.output + (row.usage?.outputTokens ?? 0)
    }), { input: 0, output: 0 });
    const wall = all.reduce((sum, row) => sum + row.wallMs, 0);
    lines.push('## Jev cost', '');
    lines.push(`Paid requests: ${scored.length}. Input tokens ${fmt(usage.input)}, output tokens ${fmt(usage.output)}, ` +
        `total ${fmt(usage.input + usage.output)}.`);
    if (scored.length) {
        lines.push(`Per scored finding: ${Math.round(usage.input / scored.length)} in, ` +
            `${Math.round(usage.output / scored.length)} out, ${Math.round(wall / all.length)} ms.`);
    }
    const truncated = scored.filter(row => row.truncated).length;
    if (truncated) lines.push(`${truncated} request${truncated === 1 ? '' : 's'} sent partial context; see \`truncated\`.`);
    lines.push('');
    lines.push('Jev does not change what `predict_failures` detects. Detection and false-alarm counts are');
    lines.push('unchanged from [RESULTS.md](RESULTS.md); this page only measures how Jev ranks findings.');
    return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('jev-report.mjs')) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const input = path.resolve(here, process.argv.find(a => a.startsWith('--input='))?.slice(8) ?? 'results-jev-discrimination.json');
    console.log(report(JSON.parse(await fs.readFile(input, 'utf8'))));
}
