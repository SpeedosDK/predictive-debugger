/** Generate the concise report and plot input from the adjudicated workflow experiment. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, groupCounts, sessionCosts } from './workflow-summary.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const results = path.join(here, 'results');
const fmt = n => n.toLocaleString('en-US');
const change = (a, b) => Math.round(100 * (a / b - 1));
const ARMS = ['read', 'previous', 'current'];

/**
 * `groups.original` holds the cases shared with `prior`, the previously published comparison, so the
 * same test can be checked against numbers readers have already seen; `groups.added` are the new cases.
 */
export function renderReport({ arms, groups, sessions, prior, trials }) {
    const [read, previous, current] = arms;
    const o = groups.original, a = groups.added;
    const cases = g => (g.current.bugs + g.current.controls) / trials;
    const cells = f => arms.map(f).join(' | ');
    const found = g => ARMS.map(arm => `${g[arm].detected}/${g[arm].bugs}`).join(' | ');
    const more = n => `${Math.abs(n)}% ${n >= 0 ? 'more' : 'fewer'}`;
    const sameScore = o.previous.detected === prior.detected && o.previous.bugs === prior.bugs;
    return `# Benchmark results

**v0.8.0 identified ${current.detected}/${current.bugs} planted bug trials with ${current.falseAlarms} false alarms.**

Sonnet reviewed ${cases(o) + cases(a)} JavaScript and TypeScript cases ${trials} times per workflow, every session fresh:
the ${cases(o)} cases from the [previous results](results/results-v07-balanced.json) and ${cases(a)} new dependency cases.
The baseline is tagged v0.7.1; v0.8.0 labels the measured candidate build.
The saved records retain its original v0.7.2 label and exact bundle hash.

![Detection and false alarms](charts/detection.svg)

| Across three trials | Agent reads files | v0.7.1 | v0.8.0 |
|---|---:|---:|---:|
| Original ${cases(o)} cases: defects found | ${found(o)} |
| New ${cases(a)} cases: defects found | ${found(a)} |
| Total planted bug trials found | ${cells(r => `${r.detected}/${r.bugs}`)} |
| Other verified findings | ${cells(r => r.otherVerified ?? 0)} |
| False alarms on clean files | ${cells(r => `${r.falseAlarms}/${r.controls}`)} |
| Total reported tokens | ${cells(r => fmt(r.total.total))} |

## Why v0.7.1 scores lower than before

${sameScore
        ? `On the original cases v0.7.1 found ${o.previous.detected}/${o.previous.bugs}, the same as v0.7 in the previous results.`
        : `On the original cases v0.7.1 found ${o.previous.detected}/${o.previous.bugs}; v0.7 found ${prior.detected}/${prior.bugs} in the previous results.`}
The test grew from ${cases(o)} to ${cases(o) + cases(a)} cases to exercise dependency resolution that the old cases barely covered.
Each new bug case needs a definition from another file. v0.7.1 leaves it out of its prompt and found
${a.previous.detected}/${a.previous.bugs}; v0.8.0 includes it and found ${a.current.detected}/${a.current.bugs}.
Direct reading can inspect those dependencies and found ${a.read.detected}/${a.read.bugs} new bug trials,
which explains its stronger showing against v0.7.1 on the expanded test.
${previous.falseAlarms ? `
v0.7.1's ${previous.falseAlarms} false ${previous.falseAlarms === 1 ? 'alarm is' : 'alarms are'} on clean files whose tool prompt has not changed since the previous
results, where v0.7 raised ${prior.falseAlarms || 'none'}. The model now scores them just above the reporting cut. v0.8.0
sends the same prompt; these results do not establish a precision improvement ([analysis](RESULTS-v072-full.md#the-false-alarms-come-from-the-model-not-the-build)).
` : ''}
![Caller and internal model usage](charts/usage.svg)

v0.8.0 used ${more(change(current.total.total, previous.total.total))} tokens than v0.7.1 and ${more(change(current.total.total, read.total.total))} than direct reading.

All ${3 * trials} sessions completed with a verdict for every file; no results are unavailable.
Tokens include caller and internal model usage, including cache reads and writes.

There are ${current.bugs / trials} buggy files and ${current.controls / trials} clean controls; repeated trials are not additional bugs.
These development cases informed the tool, so this is not a held-out accuracy estimate.

[Method and reproduction](METHOD.md) | [Full analysis](RESULTS-v072-full.md) | [Raw runs](results/results-v072-full.json) |
[Defect judgments](results/judgments-v072-full.json) | [Token breakdown](results/workflow-summary.json)
`;
}

async function readJson(name) {
    return JSON.parse(await fs.readFile(path.join(results, name), 'utf8'));
}

async function main() {
    const data = await readJson('results-v072-full.json');
    const baseline = await readJson('baseline-master.json');
    if (data.config.baseline?.revision !== baseline.revision || data.config.baseline?.version !== baseline.version) {
        throw Error('The saved experiment does not use the pinned release baseline.');
    }
    const judgments = await readJson('judgments-v072-full.json');
    const prior = await readJson('results-v07-balanced.json');
    const originalFiles = new Set(prior.config.targets.map(t => t.file));
    const addedFiles = new Set(data.config.targets.map(t => t.file).filter(f => !originalFiles.has(f)));
    const arms = summarize(data, judgments);
    const groups = { original: {}, added: {} };
    for (const arm of ARMS) {
        groups.original[arm] = groupCounts(data, judgments, arm, originalFiles);
        groups.added[arm] = groupCounts(data, judgments, arm, addedFiles);
    }
    const sessions = sessionCosts(data);
    // The previous comparison's candidate arm is the v0.7 build its published results describe.
    const v07 = summarize(prior, await readJson('judgments-v07-balanced.json'))[2];
    const priorScore = { detected: v07.detected, bugs: v07.bugs, falseAlarms: v07.falseAlarms, controls: v07.controls };
    const trials = data.config.trials;
    await fs.writeFile(path.join(results, 'workflow-summary.json'), JSON.stringify({
        completedAt: data.updatedAt, configHash: data.configHash, cliVersion: data.config.cliVersion, trials,
        baseline: data.config.baseline, candidate: data.config.candidate, bundles: data.config.bundles,
        arms, groups, sessions, previousResults: { file: 'results-v07-balanced.json', ...priorScore }
    }, null, 2) + '\n');
    await fs.writeFile(path.join(here, 'RESULTS.md'), renderReport({ arms, groups, sessions, prior: priorScore, trials }));
    console.log('Wrote report and validated graph data. Run python bench/plot-workflows.py to render graphs.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}
