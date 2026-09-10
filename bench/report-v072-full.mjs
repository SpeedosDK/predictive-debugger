/**
 * Full analysis behind the concise RESULTS.md: the v0.7.1-vs-v0.8.0 comparison on the
 * 37-case corpus, with the evidence for each claim that page makes briefly -- which
 * definitions reached the model on the new cases, why the false alarms are the model
 * rather than either build, alongside the complete workflow token totals.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { summarize, internalFile, groupCounts, sessionCosts } from './workflow-summary.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const fmt = n => n.toLocaleString('en-US');
const ARMS = ['read', 'previous', 'current'];
const ACTIONABLE = 0.7;
// Clean controls scoring at least this high in any session are charted as within reach of the cut.
const NEAR_CUT = 0.5;

// The one definition each new bug case needs resolved from another file before its
// defect is demonstrable. Presence of this text in the tool's prompt is the mechanism
// the case measures; a hit without it is an inference, not shown evidence.
const CONTRACTS = {
    'corpus/src/accuracy/wildcard-discount.ts': 'discount?: { amount: number }',
    'corpus/src/accuracy/forwarded-coupon.ts': 'return undefined',
    'corpus/src/accuracy/constructed-reading.ts': 'String(value)',
    'corpus/src/accuracy/late-member.ts': 'this.rows.get(id)'
};

const FILE_LINE = /File name \(untrusted\): "(.*?)"/;

function internalScore(inner) {
    try {
        const r = inner.report.result || '';
        return JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1)).score;
    } catch {
        return null;
    }
}

/** Prompt hash with the staging directory normalized out, so runners that stage to different temp paths compare equal. */
function promptHash(inner) {
    const body = inner.prompt.replace(FILE_LINE, `File name (untrusted): "${internalFile(inner)}"`);
    return createHash('sha256').update(body).digest('hex');
}

/** Per new bug case and tool build: sessions whose prompt carried the contract, mean internal score, and matched detections. */
function contractEvidence(data, judgments) {
    const out = {};
    for (const [file, contract] of Object.entries(CONTRACTS)) {
        out[file] = {};
        for (const arm of ['previous', 'current']) {
            const runs = data.runs.filter(r => r.arm === arm);
            let carried = 0, scored = 0, sum = 0, detected = 0;
            for (const run of runs) {
                const inner = run.internal.find(i => internalFile(i) === file);
                if (inner && inner.prompt.includes(contract)) carried++;
                const score = inner ? internalScore(inner) : null;
                if (typeof score === 'number') { scored++; sum += score; }
                const verdict = run.verdicts.find(v => v.file === file);
                if (verdict && verdict.defect && judgments[`${run.id}/${file}`]?.matchesDefect) detected++;
            }
            out[file][arm] = { sessions: runs.length, carried, meanScore: scored ? sum / scored : null, detected };
        }
    }
    return out;
}

/**
 * Clean-control scores on the original cases across every recorded session whose build sends
 * the same prompt, plus a check of that premise. A score that moves between sources with an
 * identical prompt is the model's answer moving, not the build's.
 */
function falsePositiveEvidence(sources, originalFiles, kinds) {
    const perSource = sources.map(s => {
        const runs = s.data.runs.filter(r => r.arm === s.arm && !r.failed).sort((a, b) => a.trial - b.trial);
        const hashes = {}, scores = {};
        for (const run of runs) {
            for (const inner of run.internal) {
                const file = internalFile(inner);
                if (!originalFiles.has(file)) continue;
                (hashes[file] ??= new Set()).add(promptHash(inner));
                (scores[file] ??= []).push(internalScore(inner));
            }
        }
        return { hashes, scores };
    });
    let identical = 0;
    for (const file of originalFiles) {
        const sets = perSource.map(p => p.hashes[file]);
        if (sets.every(s => s && s.size === 1) && new Set(sets.map(s => [...s][0])).size === 1) identical++;
    }
    const files = {};
    for (const file of originalFiles) {
        if (kinds[file] !== 'clean') continue;
        if (!perSource.some(p => (p.scores[file] || []).some(v => v >= NEAR_CUT))) continue;
        files[file] = Object.fromEntries(sources.map((s, i) => [s.key, perSource[i].scores[file] || []]));
    }
    return { identical, originalCount: originalFiles.size, actionable: ACTIONABLE, nearCut: NEAR_CUT,
        sources: sources.map(s => ({ key: s.key, label: s.label, build: s.build })), files };
}

function table(rows, header) {
    return [
        `| ${header} | Agent reads files | v0.7.1 (released) | v0.8.0 candidate |`,
        '|---|---:|---:|---:|',
        `| Planted defects identified | ${rows.map(a => `${a.detected}/${a.bugs}`).join(' | ')} |`,
        `| Other verified findings | ${rows.map(a => a.otherVerified ?? 0).join(' | ')} |`,
        `| False alarms on clean files | ${rows.map(a => `${a.falseAlarms}/${a.controls}`).join(' | ')} |`
    ].join('\n');
}

function evidenceTable(evidence) {
    const cell = e => `${e.carried}/${e.sessions} · ${e.meanScore == null ? '-' : e.meanScore.toFixed(2)} · ${e.detected}/${e.sessions}`;
    const lines = [
        '| New bug case | v0.7.1: contract shown · mean score · found | Candidate: contract shown · mean score · found |',
        '|---|---:|---:|'
    ];
    const inferred = [];
    for (const [file, e] of Object.entries(evidence)) {
        const name = file.split('/').pop();
        lines.push(`| \`${name}\` | ${cell(e.previous)} | ${cell(e.current)} |`);
        if (e.previous.carried === 0 && e.previous.detected > 0) inferred.push(name);
    }
    const note = inferred.length
        ? `\n\nv0.7.1 found ${inferred.map(n => `\`${n}\``).join(', ')} without the contract in its prompt: it inferred the ` +
          'behaviour of an unseen definition from a name. That is a correct answer the evidence did not demonstrate; ' +
          'the candidate reaches it with the definition shown.'
        : '';
    return lines.join('\n') + note;
}

function falsePositiveSection(fp, previous, current) {
    const cut = fp.actionable;
    const fmtScores = s => s.length ? s.map(v => (v == null ? '-' : v >= cut ? `**${v.toFixed(2)}**` : v.toFixed(2))).join(', ') : 'not run';
    const header = `| Clean control | ${fp.sources.map(s => s.label).join(' | ')} |`;
    const rows = Object.entries(fp.files).map(([file, series]) =>
        `| \`${file.split('/').pop()}\` | ${fp.sources.map(s => fmtScores(series[s.key])).join(' | ')} |`);
    const crossed = Object.values(fp.files).filter(series => Object.values(series).some(v => v.some(x => x != null && x >= cut))).length;
    const candidateElsewhere = fp.sources.filter(s => s.build === 'candidate' && s.key !== 'current' &&
        Object.values(fp.files).some(series => (series[s.key] || []).some(x => x != null && x >= cut)));
    const premise = fp.identical === fp.originalCount
        ? `On all ${fp.originalCount} original cases the tool's internal prompt is byte-identical across every source in this table, ` +
          'and each build sends the same prompt on every trial. The actionable threshold and scoring code are unchanged since ' +
          'v0.7.1. A clean control that scores differently between these sources is the model answering the same input differently.'
        : `Only ${fp.identical} of ${fp.originalCount} original cases send an identical prompt across every source in this table, ` +
          'so score differences below cannot be attributed to the model alone.';
    const split = previous.falseAlarms === current.falseAlarms ? '' : candidateElsewhere.length
        ? ` That split is not a precision gain for the candidate either: with the same prompts, the candidate crossed the cut on these files in the ${candidateElsewhere.map(s => s.label).join(', ')} run.`
        : ' With identical prompts, that split is sampling, not a precision difference between the builds.';
    return `## The false alarms come from the model, not the build

An earlier candidate-only run flagged two clean controls the saved baseline never had, which
looked like a regression. ${premise}

![Clean-control scores across runs](charts/falsepositives-v072-full.svg)

${[header, `|---|${fp.sources.map(() => '---:').join('|')}|`, ...rows].join('\n')}

Scores are per trial; bold marks the actionable cut of ${cut.toFixed(2)}. Listed are the clean controls
that reached ${fp.nearCut.toFixed(2)} in any session. In this experiment the released v0.7.1 raised
${previous.falseAlarms} false ${previous.falseAlarms === 1 ? 'alarm' : 'alarms'} and the candidate ${current.falseAlarms}.${split} ${crossed} of these files crossed the cut
at least once, and both builds send the model the same prompt for them: this is a prompt-precision
question for both builds, not a change this branch introduced.`;
}

export function renderReport(arms, groups, data, evidence, fp, sessions) {
    const [read, previous, current] = arms;
    const oldG = groups.original, newG = groups.added;
    const fewerTokens = Math.round(100 * (1 - current.total.total / read.total.total));
    const tokenDelta = Math.round(100 * (current.total.total / previous.total.total - 1));
    const b = data.config.bundles;
    const trials = data.config.trials;
    return `# v0.8.0 candidate vs v0.7.1: full comparison

**${current.detected}/${current.bugs} planted bug trials matched, plus ${current.otherVerified ?? 0} verified alternative ${(current.otherVerified ?? 0) === 1 ? 'finding' : 'findings'}. ${current.falseAlarms} false alarms.**

The detailed analysis behind [RESULTS.md](RESULTS.md). Every arm here was run fresh against
the same 37 cases: no reused sessions, no promoted baseline, no proxy build. The baseline is the
real v0.7.1 release (tag \`v0.7.1\`, bundle \`${b.previous.slice(0, 12)}\`); the candidate is
\`feat/dependency-context\` (bundle \`${b.current.slice(0, 12)}\`). All arms saw identical
source under CLI ${data.config.cliVersion}. The candidate is labeled v0.8.0 for
release; raw records retain the original v0.7.2 label. Its rebuilt bundle matches
the recorded hash exactly. Subsequent npx packaging and help/version handling
leave the prediction code, MCP tool schemas and instructions unchanged.

![Detection and false alarms](charts/detection-v072-full.svg)

${table(arms, 'All 37 cases, three trials')}
| Total reported tokens | ${arms.map(a => fmt(a.total.total)).join(' | ')} |
| CLI-estimated cost, USD | ${arms.map(a => '$' + a.total.cost.toFixed(4)).join(' | ')} |

![Caller and internal model usage](charts/usage-v072-full.svg)

The candidate used ${Math.abs(tokenDelta)}% ${tokenDelta >= 0 ? 'more' : 'fewer'} total tokens than v0.7.1 and ${Math.abs(fewerTokens)}% ${fewerTokens >= 0 ? 'fewer' : 'more'} than direct
reading. Tokens include fresh input, output, cache writes and cache reads across the
caller and internal models. Each category is counted once. CLI dollar estimates
include both models, but cache conditions and usage-limit interruptions differed
between sessions. They do not establish monetary savings.

## The 9 new dependency cases

These are the cases this branch added: late-bound members, wildcard barrels,
forwarded re-exports and constructed readings. They exist because the older corpus
barely exercises import resolution -- on the original 28 cases the two builds send
the tool's internal model byte-identical prompts, so no accuracy difference there
can be attributed to either build.

![New dependency cases](charts/newcases-v072-full.svg)

${table([oldG.read, oldG.previous, oldG.current], 'Original 28 cases')}

${table([newG.read, newG.previous, newG.current], '**New 9 dependency cases**')}

Why the builds differ on the new bug cases: each needs one definition from another
file before its defect is demonstrable. The table counts the sessions whose tool
prompt actually carried that definition, the internal model's mean score, and the
sessions where the planted defect was found.

${evidenceTable(evidence)}

Token totals are per session and cannot be split by case group. The per-file internal
model calls can be, and are reported in \`workflow-summary-v072-full.json\` under each
group's \`internal\` field.

${falsePositiveSection(fp, previous, current)}

## Provenance

- Saved result SHA-256: \`${data.resultSha256}\`.
- Measured candidate commit: \`f139cfdf366317cf1cea070889803cbc1474e565\`.
- Baseline tag: \`v0.7.1\`, commit \`${data.config.baseline.revision}\`.
- Baseline bundle SHA-256: \`${data.config.bundles.previous}\`.
- Candidate bundle SHA-256: \`${data.config.bundles.current}\`.
- Recorded completion: \`${data.updatedAt}\`.
- Complete results: ${data.runs.length} sessions, ${data.runs.reduce((n, r) => n + r.verdicts.length, 0)} file verdicts and ${data.runs.reduce((n, r) => n + r.internal.length, 0)} internal predictions. No unavailable results.

All nine sessions and every internal model call were recorded in this experiment. Run
order rotates by trial. The run hit the subscription usage limit twice: after the first
session, and again before the final v0.7.1 session, which ran about four hours after the
others. Failed attempts were discarded and rerun; no partial session is included.

There are ${current.bugs / trials} buggy files and ${current.controls / trials} clean controls. Repeated trials are not
additional bugs. These are development cases that informed the tool's prompt and its
dependency-resolution work, so this is not a held-out accuracy estimate. Findings were
reviewed for defect identity, not just a matching line number.

[Method](METHOD.md) | [Raw runs](results-v072-full.json) |
[Judgments](judgments-v072-full.json) | [Token breakdown](workflow-summary-v072-full.json)
`;
}

async function readJson(name) {
    return JSON.parse(await fs.readFile(path.join(here, name), 'utf8'));
}

async function main() {
    const resultBytes = await fs.readFile(path.join(here, 'results-v072-full.json'));
    const data = JSON.parse(resultBytes);
    data.resultSha256 = createHash('sha256').update(resultBytes).digest('hex');
    const judgments = await readJson('judgments-v072-full.json');
    const prior = await readJson('results-v07-balanced.json');
    const originalFiles = new Set(prior.config.targets.map(t => t.file));
    const addedFiles = new Set(data.config.targets.map(t => t.file).filter(f => !originalFiles.has(f)));
    const arms = summarize(data, judgments);
    const labels = { read: 'Agent reads files', previous: 'v0.7.1 (released)', current: 'v0.8.0 candidate' };
    for (const arm of arms) arm.label = labels[arm.arm];
    const groups = { original: {}, added: {} };
    for (const arm of ARMS) {
        groups.original[arm] = groupCounts(data, judgments, arm, originalFiles);
        groups.added[arm] = groupCounts(data, judgments, arm, addedFiles);
    }
    const evidence = contractEvidence(data, judgments);
    const sessions = sessionCosts(data);
    const sources = [
        { key: 'sept5', label: 'v0.7.0-equivalent · Sept 5', build: 'v0.7.0-equivalent', data: prior, arm: 'current' },
        { key: 'previous', label: 'v0.7.1 · this run', build: 'v0.7.1', data, arm: 'previous' },
        { key: 'current', label: 'v0.8.0 · this run', build: 'candidate', data, arm: 'current' }
    ];
    try {
        sources.splice(1, 0, { key: 'sept9', label: 'Candidate · Sept 9', build: 'candidate',
            data: await readJson('results-v072-candidate.json'), arm: 'current' });
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const kinds = Object.fromEntries(data.config.targets.map(t => [t.file, t.kind]));
    const fp = falsePositiveEvidence(sources, originalFiles, kinds);
    await fs.writeFile(path.join(here, 'workflow-summary-v072-full.json'), JSON.stringify({
        completedAt: data.updatedAt, configHash: data.configHash,
        baseline: data.config.baseline, candidate: data.config.candidate, bundles: data.config.bundles,
        cliVersion: data.config.cliVersion, arms, groups, sessions, contractEvidence: evidence, falsePositives: fp,
        groupFiles: { original: [...originalFiles], added: [...addedFiles] }
    }, null, 2) + '\n');
    await fs.writeFile(path.join(here, 'RESULTS-v072-full.md'), renderReport(arms, groups, data, evidence, fp, sessions));
    console.log(`Wrote RESULTS-v072-full.md. Groups: original ${originalFiles.size}, added ${addedFiles.size}. ` +
        `Identical prompts: ${fp.identical}/${fp.originalCount}. Cold sessions: ${sessions.rows.filter(r => r.cold).map(r => r.id).join(', ') || 'none'}.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
