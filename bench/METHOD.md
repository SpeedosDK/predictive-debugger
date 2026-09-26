# Benchmark method

## Current results

[RESULTS.md](RESULTS.md) is the current summary: an agent reading the files, the released
v0.8.2 and this build, in full sessions with Claude, Copilot and Codex on all 49 cases.
[The final comparison](checkpoints/FINAL-COMPARISON.md) has the setup, judgments and
failed sessions.

Earlier release reports (v0.8.0 against v0.7.1 and before) are in Git history: see
[bench/ at v0.8.0](https://github.com/SpeedosDK/predictive-debugger/tree/v0.8.0/bench).

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
| `holdout-rescore.mjs`, `recheck-effect.mjs`, `type-check.mjs`, `*-checkpoint.mjs` | Analysis and single-checkpoint runners. `usage.mjs` holds the shared token accounting and the `discovered`-defect rule. |
| `results/` | Every saved measurement and judgment, named by the experiment that wrote it. |
| `checkpoints/` | Write-ups of each development experiment, newest last below. |

- `RESULTS.md` is maintained by hand from the checkpoint it links.
- `results/results-cache-v083-isolated.json` is the source record the runners stage and
  hash-check the 37 development targets against. Keep it.
- `manifest.json` lists under `discovered` two defects the corpus generator created by
  accident. A verdict naming one is scored as a verified finding, never as a detection of
  the planted bug or a false alarm.
- Removed experiments and older reports remain in Git history.

## Running a new comparison

The runners support Windows and use each CLI's existing login. They stage the source
outside this repository without answer keys or results. Direct reading can use Read,
Glob and Grep; tool sessions use the real MCP server. Arm order rotates across trials.
Each session starts a new conversation, but provider caches are not reset between
sessions.

Verify the latest release tag and commit before selecting a baseline. Reuse compatible
saved sessions when their source, answer keys, trial count, resolved models, CLI,
workflow prompts and capture settings match. The saved arm's build must actually
represent that release. `--reuse-baselines` validates compatible sessions but does not
promote an older experiment's candidate into a baseline. Explain missing or incompatible
records before rerunning a baseline.

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

Review every positive verdict the line rule cannot settle (`judgment-candidates.mjs`
lists them). The planted defect cited on a nearby line counts as detected; a different
verified defect receives separate credit. Judgments bind to the reply's hash, so a rerun
cannot inherit them.

Report matching case and prediction counts, false alarms, unavailable results and
complete token usage: the caller plus every internal call, each cache category counted
once. Use tokens rather than CLI dollar estimates for comparisons; cache conditions
differ between sessions. The development cases informed the tool; only the `holdout`
cases measure anything close to held-out accuracy.

## Checkpoints

[Dependency improvements and local measurements](checkpoints/DEPENDENCY-IMPROVEMENTS.md)

[Claude provider cache and isolation checkpoint](checkpoints/CACHE-CHECKPOINT.md)

[Cross-provider batching experiment and token accounting](checkpoints/BATCHING-CHECKPOINT.md)

[Production compiler checks, grouped workflows and accuracy limitations](checkpoints/PRODUCTION-IMPROVEMENTS.md)

[Grouped prediction accuracy and near-gate re-checks](checkpoints/ENGINE-ACCURACY.md)

[Agent reading vs. v0.8.2 vs. this build, all 49 cases](checkpoints/FINAL-COMPARISON.md)
