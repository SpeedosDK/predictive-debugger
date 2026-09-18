/**
 * Composes RESULTS-jev.md from the saved Jev experiments. Regenerate with
 * `node bench/jev-results.mjs`; edit this generator rather than the page.
 *
 * The question is whether Jev beats not using Jev, so every AUC here is reported against
 * the tool's own score rather than against chance. "No Jev" is not an unordered list --
 * it is the ordering `predict_failures` already produces for free.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auc } from './jev-report.mjs';
import { classify } from './adversarial-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = async name => JSON.parse(await fs.readFile(path.join(here, name), 'utf8'));
const fmt = n => n.toLocaleString('en-US');

const replay = await read('results-jev-openrouter.json');
const adversarial = await read('results-adversarial.json');

const scored = replay.scored.filter(row => row.status === 'scored');
const judged = scored.filter(row => row.stratum === 'judged');

/** Every candidate ordering, including the one that costs nothing. */
function table(rows) {
    const positive = rows.filter(r => r.correct);
    const negative = rows.filter(r => !r.correct);
    const of = f => auc(positive.map(f), negative.map(f));
    return {
        positive: positive.length, negative: negative.length,
        baseline: of(r => r.cliScore),
        evidence: of(r => r.evidence.score),
        impact: of(r => r.impact.score),
        priority: of(r => r.priority),
        blended: of(r => r.cliScore * r.priority)
    };
}
const main = table(judged);
const all = table(scored);

const advRows = adversarial.rows.map(row => ({ ...row, ...classify(row) }));
const advBugs = advRows.filter(r => r.kind === 'buggy');
const advControls = advRows.filter(r => r.kind === 'clean');
const advFound = advBugs.filter(r => r.correct).length;
const advFooled = advControls.filter(r => r.finding).length;

const tokens = scored.reduce((sum, row) =>
    sum + (row.usage?.inputTokens ?? 0) + (row.usage?.outputTokens ?? 0), 0);
const advTokens = advRows.filter(r => r.jev?.status === 'scored')
    .reduce((sum, row) => sum + (row.jev.usage?.inputTokens ?? 0) + (row.jev.usage?.outputTokens ?? 0), 0);

const row = (label, value) => `| ${label} | ${value === null ? '—' : value.toFixed(3)} |`;

const page = `# Is Jev better than not using Jev?

**No, on this evidence.** The score \`predict_failures\` already produces separates correct
findings from wrong ones better than any Jev signal, and blending Jev in makes it worse.

Jev is ranking-only — it leaves \`score\`, \`combinedScore\`, \`actionable\` and finding order
untouched — so it cannot change what the tool detects. Detection and false-alarm counts are
the ones in [RESULTS.md](RESULTS.md). The only thing Jev can improve is the order findings
are presented in, and "not using Jev" means the free ordering, not no ordering at all.

## The head-to-head

${main.positive} correct findings against ${main.negative} wrong ones, replayed from the saved sessions.

| Ranking signal | AUC |
|---|---:|
${row('**Tool score — free, this is "no Jev"**', main.baseline)}
${row('Jev evidence', main.evidence)}
${row('Jev impact', main.impact)}
${row('Jev priority (evidence x impact)', main.priority)}
${row('Tool score x Jev priority', main.blended)}

0.5 is no separation. The free baseline wins by ${(main.baseline - main.priority).toFixed(3)}.

Widening to every scored finding, including those below the actionable cut
(${all.positive} correct, ${all.negative} wrong), does not change the verdict: baseline
${all.baseline.toFixed(3)}, Jev priority ${all.priority.toFixed(3)}.

Two details worth keeping:

- **Evidence is Jev's weakest dimension** (${main.evidence.toFixed(3)}), despite being the one that
  should catch a false alarm. Impact carries what separation there is (${main.impact.toFixed(3)}).
- **Blending hurts.** Multiplying the tool's score by Jev's priority scores
  ${main.blended.toFixed(3)}, below the ${main.baseline.toFixed(3)} of the score on its own. Jev is not
  adding information the tool lacks; it is diluting information the tool has.

## Why the adversarial cases could not settle it

${advControls.length} controls were written to trip the detector, each matching a bug shape it knows, plus
${advBugs.length} real defects wearing innocuous shapes. The detector found ${advFound}/${advBugs.length} of the defects and was
fooled by ${advFooled}/${advControls.length} of the controls.

With no false alarms there is no negative class, so these cases produce no ranking
measurement at all. That is a strong result for the detector and a dead end for this
experiment. Running a weaker model to manufacture false alarms was tried and discarded:
it works, but the result is no longer comparable with anything in \`RESULTS.md\`.

An earlier draft of the controls was itself defective — two dereferenced values their
guards did not cover, one oversold stock to -5 under concurrency. The detector reported all
three and was right each time, and the run scored a spurious priority AUC of 0.000 purely
because the answer key was wrong. \`adversarial-cases.test.mjs\` now executes every case, so
the key is demonstrated rather than asserted.

## Cost

| Experiment | scored findings | tokens |
|---|---:|---:|
| Saved corpus replay | ${scored.length} | ${fmt(tokens)} |
| Adversarial | ${advRows.filter(r => r.jev?.status === 'scored').length} | ${fmt(advTokens)} |

At \`typesafe/jev-1.13\` list price (prompt $0.042/Mtok, completion free) this is well under
a cent. Cost is not the argument against Jev; the free baseline outranking it is.

## What this does not establish

The negative class is ${main.negative} findings. One reclassification moves these AUCs materially, so
the size of the gap is not trustworthy even though its direction is consistent across every
cut of the data. These are development cases that informed the tool, not a held-out sample.

A fair reading is "Jev did not earn its place on the evidence available", not "Jev is
useless". What would change the answer is a population with enough wrong findings to
measure, which a detector that declined all ${advControls.length} purpose-built traps does not supply.

[Method](METHOD.md) | [Replay](results-jev-openrouter.json) | [Adversarial](results-adversarial.json)
`;

await fs.writeFile(path.join(here, 'RESULTS-jev.md'), page);
console.log('wrote bench/RESULTS-jev.md');
