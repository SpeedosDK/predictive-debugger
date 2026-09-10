# Workflow comparison

## Current report: v0.7.2 candidate against v0.7.1

[RESULTS.md](RESULTS.md) summarizes the completed 37-case experiment in
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

Regenerate the reports and charts from the saved results without making model calls:

```powershell
node bench/markdown.mjs
python bench/plot-workflows.py
node bench/report-v072-full.mjs
python bench/plot-v072-full.py
```

Tokens include the caller, internal model calls, auxiliary model usage, fresh input,
output, cache writes and cache reads. The current reports compare tokens only.
Dollar estimates remain in the raw records, but differing cache conditions and
usage-limit interruptions prevent a controlled monetary comparison.

## Retained files

- `RESULTS.md`, `markdown.mjs`, `plot-workflows.py` and `workflow-summary.json`
  are the main report and its generation tools.
- `RESULTS-v072-full.md`, `report-v072-full.mjs`, `plot-v072-full.py` and
  `workflow-summary-v072-full.json` contain the supporting analysis.
- `results-v072-full.json` and `judgments-v072-full.json` contain the complete
  current experiment and its hash-bound defect judgments.
- `results-v07-balanced.json` and `judgments-v07-balanced.json` support the
  comparison with the original 28 cases. `results-v072-candidate.json` supplies
  the earlier candidate's prompt and score evidence in the false-alarm analysis.
  These historical inputs are not the current release baseline.
- The final dependency-map and batch-parsing checkpoints retain their reports,
  runners and raw measurements. Earlier intermediate experiments are superseded.
- Both corpora, manifests and fixture generators remain necessary for reproduction.

The filenames retain the candidate label used when the experiment ran. They do
not set the next release version; the package remains unchanged at 0.7.1.

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
npm run compile
npm run build
node .github/scripts/check-mcp.mjs
node bench/prepare-master.mjs
node bench/workflows.mjs --model=sonnet --trials=3 --output=results-new-experiment.json
```

The baseline checkout is pinned by `baseline-master.json`. Use a new output name
when the source, build or configuration changes. `npm run bench` resumes the
saved current experiment only when its recorded configuration still matches,
then regenerates both reports and their charts. It can make model calls; use the
report-only commands above when updating presentation from completed data.

Review every positive verdict for the planted defect's identity. A different
verified defect receives separate credit. Judgments bind to source, prompt and
response hashes; missing or stale judgments block publication. Configure the
report generators to use the new result and judgment files for a new experiment.

Report matching case and prediction counts, false alarms, unavailable results
and complete token usage. Preserve original usage records, including CLI dollar
estimates, but use tokens for the published comparison. These development cases
informed the tool and do not measure held-out accuracy on arbitrary projects.

[Dependency improvements and local measurements](DEPENDENCY-IMPROVEMENTS.md)
