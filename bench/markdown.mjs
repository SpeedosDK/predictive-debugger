/** Generate the concise report and plot input from the adjudicated workflow experiment. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './workflow-summary.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const fmt = n => n.toLocaleString('en-US');
const money = n => '$' + n.toFixed(3);
export function renderReport(arms, reusedBaselines = false) {
    const [read, previous, current] = arms;
    const fewerTokens = Math.round(100 * (1 - current.total.total / read.total.total));
    const previousSaving = Math.round(100 * (1 - current.total.cost / previous.total.cost));
    const directDifference = Math.round(100 * (current.total.cost / read.total.cost - 1));
    return `# Benchmark results

**${current.detected}/${current.bugs} planted bug trials matched, plus ${current.otherVerified ?? 0} verified alternative ${(current.otherVerified ?? 0) === 1 ? 'finding' : 'findings'}. ${current.falseAlarms} false alarms.**

Sonnet reviewed the same 28 JavaScript and TypeScript cases three times per workflow.
The baseline is the pinned master commit, not an intermediate development prompt.
v0.7 is an unreleased candidate. ${reusedBaselines ? 'The candidate has 84 fresh predictions; master and reading baselines reuse matching saved sessions.' : 'All sessions and internal model calls were run fresh.'}

![Detection and false alarms](charts/detection.svg)

| Across three trials | Agent reads files | v0.6 master | v0.7 candidate |
|---|---:|---:|---:|
| Planted defects identified | ${arms.map(a => `${a.detected}/${a.bugs}`).join(' | ')} |
| Other verified findings in buggy files | ${arms.map(a => a.otherVerified ?? 0).join(' | ')} |
| False alarms on clean files | ${arms.map(a => `${a.falseAlarms}/${a.controls}`).join(' | ')} |
| Total reported tokens | ${arms.map(a => fmt(a.total.total)).join(' | ')} |
| CLI-estimated cost | ${arms.map(a => money(a.total.cost)).join(' | ')} |

![Caller and internal model usage](charts/usage.svg)

The candidate workflow cost **${Math.abs(previousSaving)}% ${previousSaving >= 0 ? 'less' : 'more'} than the v0.6 master workflow** in this run.
It cost **${Math.abs(directDifference)}% ${directDifference >= 0 ? 'more' : 'less'} than direct reading**.
It used ${Math.abs(fewerTokens)}% ${fewerTokens >= 0 ? 'fewer' : 'more'} total tokens than direct reading.
${previous.detected === current.detected && previous.falseAlarms === current.falseAlarms ? 'Both tool versions tied on detection and false alarms in this fresh comparison.' : `The v0.6 baseline detected ${previous.detected}/${previous.bugs}; the v0.7 candidate detected ${current.detected}/${current.bugs}.`}

Tokens include fresh input, output, cache writes and cache reads across the caller
and internal models. Cache state was not reset; ${reusedBaselines ? 'baseline sessions were recorded earlier' : 'run order rotated'}. These are observed
CLI cost estimates, not subscription invoices or a guarantee of future savings.

There are 13 distinct buggy files and 15 clean controls. Repeated trials are not
additional bugs. These development cases informed the tool's prompt, so this is
not a held-out accuracy estimate. Findings were reviewed for defect identity,
not just a matching line number.

[Method and reproduction](METHOD.md) | [Raw runs](results-v07-balanced.json) |
[Defect judgments](judgments-v07-balanced.json) | [Token breakdown](workflow-summary.json)
`;
}
async function main() {
    const data = JSON.parse(await fs.readFile(path.join(here, 'results-v07-balanced.json'), 'utf8'));
    const baseline = JSON.parse(await fs.readFile(path.join(here, 'baseline-master.json'), 'utf8'));
    if (data.config.baseline?.revision !== baseline.revision || data.config.baseline?.version !== baseline.version) {
        throw Error('The saved experiment does not use the pinned master baseline.');
    }
    const judgments = JSON.parse(await fs.readFile(path.join(here, 'judgments-v07-balanced.json'), 'utf8'));
    const arms = summarize(data, judgments);
    await fs.writeFile(path.join(here, 'workflow-summary.json'), JSON.stringify({
        completedAt: data.updatedAt, configHash: data.configHash,
        baseline: data.config.baseline, candidate: data.config.candidate, bundles: data.config.bundles,
        reusedBaselines: data.reusedBaselines, arms
    }, null, 2) + '\n');
    await fs.writeFile(path.join(here, 'RESULTS.md'), renderReport(arms, Boolean(data.reusedBaselines)));
    console.log('Wrote report and validated graph data. Run python bench/plot-workflows.py to render graphs.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}
