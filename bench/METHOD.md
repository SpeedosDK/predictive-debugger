# Benchmark method

## Current results

[RESULTS.md](RESULTS.md) is the current summary: an agent reading the files, the released
v0.8.2 and this build, in full sessions with Claude, Copilot and Codex on all 49 cases.
[The final comparison](checkpoints/FINAL-COMPARISON.md) has the setup, judgments and
failed sessions.

## History: v0.8.0 candidate against v0.7.1

[RESULTS-v080.md](RESULTS-v080.md) summarizes the completed 37-case experiment in
`results-v072-full.json`, recorded September 10, 2026. All three workflows ran
fresh, three times each. Each session reviewed 17 buggy files and 20 clean controls.
The baseline is tag `v0.7.1`, commit `9de9017ca4a78dcdc65484398d180bb1b461dfac`.
The candidate is an unreleased working build identified by its bundle SHA-256 in
the [full report](RESULTS-v072-full.md#provenance).

The original 28 cases remain separate from nine added dependency cases. The older
saved sessions lack those nine cases, so they cannot supply a complete baseline
for this expanded experiment. They provide historical context only. All workflows
in the current comparison saw the same source and used the same CLI configuration.
The report validates complete verdicts, usage and hash-bound judgments before writing.

Regenerate those reports and charts from the saved results without making model calls:

```powershell
npm run bench:report
python bench/plot-workflows.py
python bench/plot-v072-full.py
```

Tokens include the caller, internal model calls, auxiliary model usage, fresh input,
output, cache writes and cache reads. Token totals are the primary comparison.
The full report also lists CLI dollar estimates, but differing cache conditions
and usage-limit interruptions prevent a controlled monetary comparison.

## Layout

Nothing in `bench/` runs in CI except the `*.test.mjs` files, which `npm test` runs
with the unit tests. Every other script calls real, signed-in CLIs and is run by
hand; its output is a saved measurement, not a test.

| Where | What |
|---|---|
| `corpus/`, `corpus-ts/`, `manifest*.json` | The benchmark source and answer keys. `generate-corpus*.mjs`, `accuracy-cases.mjs`, `dependency-cases.mjs` and `holdout-cases.mjs` write them; `holdout` cases were frozen before any run. |
| `canary.mjs` | `npm run bench:canary -- --provider=<id>`: one grouped run on the 12 held-out files, PASS or DRIFT against measured thresholds, logged to `results/canary-log.jsonl`. Run it after a CLI update. |
| `engine-accuracy.mjs` | The prediction engine against real CLIs, no caller agent (`--suite=dev\|holdout\|all`, `--size`, `--trials`). Scored against the answer key's line ranges. |
| `cli-workflows.mjs`, `capture-provider.cjs` | Full sessions: an agent reading the files, the released tool, or this build (`--arms=read,previous,current`, `--caller=strict\|neutral`). `workflow-accuracy.mjs` scores them. |
| `resume-workflow.mjs`, `judgment-candidates.mjs` | Resume a stopped workflow run with its failed sessions kept; list the verdicts that need a manual judgment. |
| `markdown.mjs`, `report-v072-full.mjs`, `plot-*.py` | Regenerate the historical v0.8.0 reports (`npm run bench:report`); no model calls. The runner that produced them is in Git history. |
| `holdout-rescore.mjs`, `recheck-effect.mjs`, `type-check.mjs`, `*-checkpoint.mjs` | Analysis and single-checkpoint runners. `usage.mjs` holds the shared token accounting and the `discovered`-defect rule. |
| `results/` | Every saved measurement and judgment, named by the experiment that wrote it. |
| `checkpoints/` | Write-ups of each development experiment, newest last below. |

- `RESULTS.md` is maintained by hand from the checkpoint it links. `RESULTS-v080.md`,
  `markdown.mjs`, `plot-workflows.py` and `results/workflow-summary.json` are the v0.8.0
  report and its generation tools.
- `RESULTS-v072-full.md`, `report-v072-full.mjs`, `plot-v072-full.py` and
  `results/workflow-summary-v072-full.json` contain the supporting analysis.
- `results/results-v072-full.json` and `results/judgments-v072-full.json` contain the
  complete v0.8.0 experiment and its hash-bound defect judgments.
- `results/results-v07-balanced.json` and `results/judgments-v07-balanced.json` support
  the comparison with the original 28 cases. `results/results-v072-candidate.json`
  supplies the earlier candidate's prompt and score evidence in the false-alarm
  analysis. These historical inputs are not the current release baseline.
- `results/results-cache-v083-isolated.json` is the source record the newer runners
  stage and hash-check the 37 development targets against.
- Superseded experiments were removed from the tree after commit `87edf8d` and can be
  restored from it.

The filenames and raw records retain the v0.7.2 candidate label used when the
experiment ran. The release is v0.8.0; report and graph labels use that version.
Relabeling does not change the measurements or the recorded build hashes.
[Release validation](results/release-v080.json) records the final v0.8.0 bundle hash,
reproduced baseline and candidate bundle hashes, and the reused result file hash.
All 83 recorded corpus files match, and the final MCP schemas and instructions
match the measured candidate. Core and provider sources are unchanged.

## Running a new comparison

The capture runner supports Windows and uses the existing Claude CLI login.
It stages source outside this repository without answer keys or results. Direct
reading can use Read, Glob and Grep; tool workflows use the real MCP server and
follow actionable verdicts. Workflow order rotates across trials. Each session
starts a new conversation, but provider caches are not reset between sessions.

Verify the latest release tag and commit before selecting a baseline. Reuse
compatible saved sessions when their source, answer keys, trial count, resolved
models, CLI, workflow prompts and capture settings match. The saved arm's build
must actually represent that release. `--reuse-baselines` validates compatible
sessions but does not promote an older experiment's candidate into a baseline.
Explain missing or incompatible records before rerunning a baseline.

```powershell
npm ci
npm run build
node .github/scripts/check-mcp.mjs
node bench/cli-workflows.mjs --provider=claude --model=sonnet --arms=read,previous,current `
    --trials=2 --suite=all --caller=neutral --output=results-new-experiment.json
node bench/workflow-accuracy.mjs results-new-experiment.json --judgments=judgments-new.json
```

`previous` runs the release checkout in `.tmp/benchmark-v082` and refuses to start unless
its commit and bundle match v0.8.2; replace that pin when a newer release becomes the
baseline. Use a new output name when the source, build or configuration changes. A run
stops at the first failed session; `resume-workflow.mjs` copies the completed sessions
into a new file, keeps the failed ones under `failedRuns`, and the same command then runs
only what is missing.

Review every positive verdict for the planted defect's identity. A different
verified defect receives separate credit. Judgments bind to source, prompt and
response hashes; missing or stale judgments block publication. Configure the
report generators to use the new result and judgment files for a new experiment.

Report matching case and prediction counts, false alarms, unavailable results
and complete token usage. Preserve original usage records, including CLI dollar
estimates, but use tokens for the published comparison. These development cases
informed the tool and do not measure held-out accuracy on arbitrary projects.

[Dependency improvements and local measurements](checkpoints/DEPENDENCY-IMPROVEMENTS.md)

[Claude provider cache and isolation checkpoint](checkpoints/CACHE-CHECKPOINT.md)

[Cross-provider batching experiment and token accounting](checkpoints/BATCHING-CHECKPOINT.md)

[Production compiler checks, grouped workflows and accuracy limitations](checkpoints/PRODUCTION-IMPROVEMENTS.md)

[Grouped prediction accuracy and near-gate re-checks](checkpoints/ENGINE-ACCURACY.md)

[Agent reading vs. v0.8.2 vs. this build, all 49 cases](checkpoints/FINAL-COMPARISON.md)
