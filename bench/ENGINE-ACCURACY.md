# Grouped prediction accuracy: re-checking near-gate verdicts

Recorded September 26, 2026. Development checkpoint on the existing 37 targets
(17 planted bugs, 20 controls), not a release comparison or held-out estimate.

## Question

Grouping up to eight files per model call ([BATCHING-CHECKPOINT.md](BATCHING-CHECKPOINT.md))
cut internal tokens by roughly 65–80%, but the grouped workflows in
[PRODUCTION-IMPROVEMENTS.md](PRODUCTION-IMPROVEMENTS.md) lost detections on every
provider. Where does the accuracy go, and can it come back without giving up the
savings?

## Findings

1. **One prompt rule caused a systematic miss.** The grouped build added "a guard
   for a different field does not establish this field's contract". That sentence
   describes the planted `cartTotals.js` defect, and every provider answered `none`
   for it with that reasoning. It was reverted, along with two rewordings of the
   score definition that were never measured separately.
2. **Grouping lowers scores; it rarely hides the defect.** Across 12 grouped
   trials, every group verdict scored between 0 and 0.70 was a planted bug named on
   the right line. Copilot's only grouped false alarm (`order.controller.ts`) scored
   0.70–0.78 and never appeared in single-file runs.
3. **So re-check the near-gate files alone.** A group verdict that names a defect
   with a score under 0.80 gets the single-file review, and that verdict replaces
   the group's. This costs 0–5 extra calls per 37 files. Clean verdicts (`none`)
   and actionable verdicts at 0.80 or above are kept.
4. **Anchored scoring wording** (a trigger the code permits plus a result the code
   contradicts is strong evidence, and requirements must come from the shown code)
   gave a small, inconsistent improvement: Claude 27→29 and Codex 3→1 false alarms
   over two trials each, with Copilot flat. It ships because the shipped
   combination is the one measured below.

## Results

`engine-accuracy.mjs` runs the compiled engine against the real CLIs, with no
caller agent, and scores automatically: a bug counts when an actionable finding
cites a line inside the answer key's acceptable range. Every miss and false alarm
reason was read by hand, and none of the hits was on the wrong defect. Trial order
rotates so that files land in different groups. Tokens are internal model tokens
only, averaged per 37-file trial.

| Provider | Configuration | Detected (per trial) | False alarms | Tokens |
|---|---|---|---:|---:|
| Copilot | single file (release prompt shape) | 16 | 0/20 | 1,121k |
| Copilot | groups of 8, v0.8.2 wording | 13, 15 | 0/40 | 265k |
| Copilot | groups of 8 + re-check < 0.70 | 16, 16, 17 | 1/60 | 291k |
| **Copilot** | **groups of 8 + re-check < 0.80 (shipped)** | **17, 14, 15** | **0/60** | **386k** |
| Copilot | groups of 4 + re-check < 0.80 | 16, 16, 15 | 0/60 | 584k |
| Claude | single file | 16, 15 | 0/40 | 258k |
| Claude | groups of 8, v0.8.2 wording | 14, 13 | 0/40 | 70k |
| **Claude** | **groups of 8 + re-check < 0.80 (shipped)** | **16, 16, 16** | **0/60** | **90k** |
| Claude | groups of 4 + re-check < 0.80 | 16, 16, 17 | 0/60 | 127k |
| Codex | groups of 8, v0.8.2 wording | 16, 16 | 3/40 | 131k |
| **Codex** | **groups of 8 + re-check < 0.80 (shipped)** | **16, 16, 16** | **3/60** | **132k** |

Copilot CLI 1.0.82 (`claude-sonnet-5`), Claude Code 2.1.283 (`sonnet`), Codex CLI
0.157.1 (`gpt-5.6-sol`). Provider caches were not reset. Result files:
`results-engine-<provider>-<size>-<variant>.json`, each recording the engine and
runner hashes, raw prompts and replies.

## What is left

- **`reconciliationWorker.js`** (stale read across an await). Copilot and Claude
  sometimes answer `none` inside a group, and a clean verdict is not re-checked.
  Claude also missed it single-file on this CLI version.
- **`cartTotals.js`** (unguarded `row.discount` beside a defaulted `row.lines`).
  Claude and Copilot name it correctly at 0.40–0.60 even in single-file calls;
  Codex never flags it. [BATCHING-CHECKPOINT.md](BATCHING-CHECKPOINT.md) already
  records this fixture's contract as ambiguous.
- **Codex controls.** Codex flags `headers.mts` (mixed-case keys) and
  `receipt.entity.ts` (Postgres `numeric` hydrates as a string) at 0.84–0.94.
  Neither produces a wrong result in the shown code. The same prompt gives the
  other two providers no false alarms, so this was not tuned further against these
  specific controls.

## Full workflows: agent reads the files vs. agent calls the tool

`cli-workflows.mjs`, arms `read` and `current`, two rotated trials per CLI, the
same 37 targets and caller prompt as [PRODUCTION-IMPROVEMENTS.md](PRODUCTION-IMPROVEMENTS.md).
Scored by `workflow-accuracy.mjs` (line inside the answer key's range), which
reproduces the hand judgments of the earlier grouped runs exactly. One direct
Copilot verdict cited the blank line above the planted `forEach` with the planted
reason and is counted as detected. Tokens are caller plus internal calls, each
cache category counted once. This build predates the empty working directory below.

| CLI | Agent reads files | Agent + `predict_failures` | Token change |
|---|---|---|---:|
| Claude 2.1.283 | 16, 16 detected; 0/40 FA; 203k, 254k tokens | 15, 15; 0/40; 120k, 109k | −50% |
| Copilot 1.0.82 | 14, 16; 1/40; 968k, 1,144k | 16, 15; 0/40; 540k, 471k | −52% |
| Codex 0.157.1 | 16, 17; 4/40; 1,722k, 1,412k | 16, 16; 3/40; 325k, 248k | −82% |

Direct Claude reading also flags `cartTotals.js`, which the tool's reviewer names
at 0.55–0.60 and returns as `uncertain`; the benchmark caller is told to report
only actionable findings. Codex's direct review flagged a different real
`reconciliationWorker.js` defect (the backfill balance), not the planted race.
Results: `results-workflow-recheck-{claude,copilot,codex}.json`.

## Empty working directory

Each CLI loaded the project's CLAUDE.md/AGENTS.md into every review call. With a
trivial prompt, the project directory added 1.7k tokens per call for Claude
(4,073 vs 2,335), 1.2k for Codex (19,004 vs 17,771, and 2.1–7.6k uncached vs 866)
and 2.3k for Copilot. Review calls now run in an empty temporary directory.
Two trials per CLI (`results-engine-*-8-isolated.json`): Claude 15, 15 with 0/40
false alarms at 78k tokens (−13%); Copilot 15, 15 with 0/40 at 365k (−5%); Codex
16, 16 with 2/40 at 125k (−5%). Accuracy moved only on the two cases above, within
their trial-to-trial range. The saving grows with a project's instruction files.

## Held-out cases

`holdout-cases.mjs` adds 12 files to the corpus (manifest `holdout`), written and
frozen before any run: six planted bugs of kinds the development set does not
contain in that form, and six controls with a surface cue for one of them. On the
first run all three CLIs flagged the `poller.ts` control: its interval does not wait
for the previous fetch, so a slow earlier fetch can overwrite newer items. That is a
real defect its author missed, so it is kept unchanged as `discovered: true`, as
`invoice.entity.ts` was in the TypeScript corpus, leaving 7 bugs and 5 controls.
`holdout-rescore.mjs` re-scores the saved runs against that key.

| CLI | Groups of 8 (+ re-check) | Single file | Tokens, grouped vs single |
|---|---|---|---|
| Claude | 7/7, 7/7; 0/10 false alarms | 7/7, 7/7; 0/10 | 27k vs 57k |
| Codex | 7/7, 7/7; 0/10 | 7/7, 7/7; 0/10 | 44k vs 233k |
| Copilot | 6/7, 6/7; 0/10 | 6/7, 7/7; 0/10 | 92–218k vs 330k |

The two Claude runs that timed out on every call (`results-holdout-claude-{1,8}.json`)
coincided with a Claude-side outage and are excluded; the `-retry` files replace them.

## Uncertain findings and read-await-write re-checks

- **Uncertain findings reach the caller as a task.** The `predict_failures`
  description no longer says to ignore them, and replies containing one add
  `check`: read the cited lines and confirm or dismiss each. `cli-workflows.mjs
  --caller=neutral` lets the caller follow the tool's guidance and read source
  where it asks. Claude 15, 16/17 (strict caller 15, 15) at 154–164k tokens;
  Copilot 16, 17/17 (16, 15) at 437–478k. No false alarms. Claude settles an
  uncertain `cartTotals.js` by reading and grepping, which is the token increase.
  Results: `results-workflow-uncertain-{claude,copilot}.json`.
- **Read-await-write files are re-checked when their group calls them clean.**
  `staleWrite.ts` finds async functions that await a read into a local and later
  await a write-like call. Group replies called `reconciliationWorker.js` and the
  held-out `tokenBucket.ts` clean outright; single-file reviews found both. The
  detector flags 5 of 49 files: 4 bugs and the serialized `quota.ts` control, which
  single-file review cleared all 6 times. `tokenBucket.ts` informed this rule, so it
  no longer counts as held out for it.

All 49 files, two trials, every change (`results-engine-*-all-racecheck.json`;
`recheck-effect.mjs` compares each re-checked file's group and single-file verdicts):

| CLI | Detected /24 | False alarms /25 | Internal tokens |
|---|---|---|---:|
| Codex | 23, 23 | 0, 0 | 189k |
| Copilot | 22, 23 | 0, 0 | 540k |
| Claude | 22, 21 | 0, 0 | 118k |

Re-checks recovered `invoice.entity.ts`, `sync.service.ts`, `poller.ts`, `cartTotals.js`
(Copilot) and `reconciliationWorker.js` (Copilot 0.72; Claude 0.60, now surfaced as
uncertain), and cleared `adminController.js`, which a group scored 0.55.

Groups of four were within noise of groups of eight at about 50% more tokens, so
eight remains the default. None of these cases is held out: the answer key informed
every change here.

```powershell
npm run compile
node bench/engine-accuracy.mjs --provider=copilot --model=claude-sonnet-5 --size=8 --trials=3 --output=results-engine-new.json
```
