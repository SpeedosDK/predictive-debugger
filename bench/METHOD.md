# Workflow comparison

Three workflows review the same 28 development cases, three times each:

- **Direct reading:** Sonnet reads source and may inspect local dependencies using Read, Glob and Grep.
- **v0.6 master:** Sonnet calls the real MCP server from clean commit `1f77c3260bf2b59d579e75d7cdea0f67aca08503`, fetched from `origin/master`. It reports version 0.6.0.
- **v0.7 candidate:** Sonnet calls the current working build, identified by its bundle hash. It is unreleased; this benchmark does not bump the package version. Both tool workflows follow its actionable verdicts.

Each trial reviews all 28 files. The latest experiment ran three fresh candidate
sessions, making 84 internal predictions, and reused the six saved master/direct-reading
sessions after checking source, model, CLI, wrapper and baseline-build configuration.
The report contains nine caller sessions and 168 internal model-call records. No sub-agent delegation is used. The corpus is staged outside the
repository without its manifests or results. All arms see identical source.

The Sonnet alias resolved to `claude-sonnet-5` in this run. The CLI also reports small
Haiku helper calls. Both are included in token and cost totals. Tokens come from
per-model CLI usage and include fresh input, output, cache creation and cache reads.
Thinking tokens are already included in output and are not added twice. The capture
wrapper records every internal CLI response while forwarding it unchanged to the
real MCP server. Raw events demonstrate caller tool use.

Cost is the CLI's list-price estimate, including its cache accounting, not an invoice.
Cache state was not reset. The original full comparison rotated workflow order. The latest candidate sessions
ran afterward, so cache state and run timing differ between versions. The three cost totals must not be treated
as a controlled measurement of prompt efficiency alone.

The answer keys contain 13 known bugs and 15 clean controls. Human-readable judgments
bind each positive verdict to source, prompt and response hashes. A different issue in a buggy file is not counted as identifying its answer-key defect.
Verified alternative defects receive separate credit as `validDefect: true` in the
judgments and the report's other-findings row. They are not called clean results or
false alarms. The judgments also record explanation errors and unsupported findings.

These cases informed prompt development. Results describe this corpus and workflow,
not independent accuracy on arbitrary projects. Earlier isolated predictions and the intermediate-prompt comparison are
superseded by the comparison against master. The latest candidate has a separate
result file and explicitly records which baseline sessions it reuses.

## Reproduce

The capture runner currently supports Windows. From the repository root:

```powershell
npm ci
npm run compile
npm run build
node .github/scripts/check-mcp.mjs
node bench/prepare-master.mjs
node bench/workflows.mjs --model=sonnet --trials=3 --output=results-v07-balanced.json
```

The last command resumes only when source, builds, runner and CLI configuration match.
Use `--output=results-new-experiment.json` for a changed configuration. Model calls use
the existing Claude CLI login. Raw data records the CLI version and resolved models.
For a new candidate-only experiment, add `--reuse-baselines=bench/results-v07-balanced.json`
with a separate output filename. Without that option, a new experiment runs all three workflows.

Review every positive final verdict, then write `judgments-v07-balanced.json`, keyed by
`<arm>#<trial>/<corpus-relative file>`. Each judgment needs `matchesDefect`, `reason`,
`sourceHash`, `promptHash` and `responseHash`. Unknown or missing usage and stale
judgments prevent publication. The default report reads `results-v07-balanced.json`.

```powershell
python -m pip install -r bench/requirements.txt
node bench/markdown.mjs
python bench/plot-workflows.py
```

`npm run bench` rebuilds both versions, resumes the comparison, then regenerates the
report and figures. New responses need review before report generation can succeed.
Retained data includes one complete comparison, its judgments and the generated summary.
All six reused baseline sessions are embedded unchanged in `results-v07-balanced.json`.
Its `reusedBaselines.file` and SHA-256 identify the original input snapshot, which was
removed after verifying those embedded records. Reproduction does not need that snapshot.
The corpus, answer keys and pinned master revision remain. The two SVG graphs are
embedded in `RESULTS.md`; duplicate PNG exports are omitted.

## Latest candidate

The evidence policy now requires shown incompatible wiring before alleging missing
route registration, injection setup or construction code. It retains explicit optional
input contracts and resource-lifetime checks. Across three trials it identified a real
defect in every buggy file: 38 planted-defect matches and one verified alternative
watermark bug. There were no flags on clean controls. Estimated cost was $1.294,
versus $1.490 for master. These are observed
CLI estimates under different cache conditions, not a guaranteed spending limit.
