# Predictive Debugger

[![CI](https://github.com/SpeedosDK/predictive-debugger/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/SpeedosDK/predictive-debugger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Finds where code is likely to fail before it does. It ships in two shapes:

- a **VS Code extension** for a human reviewing their own code
- an **MCP server** so coding agents can use it as a tool while they review code

There is no API key and no OAuth flow. Model access is borrowed from whichever
CLI you are already signed in to — Claude Code or Codex. The extension never
sees, stores, or transmits a token; it shells out to the CLI and the CLI handles
auth.

## Layout

```
src/
  core/            analysis engine — no VS Code, no MCP, no I/O beyond files
    analysis/      AST metrics (ast.ts), heuristic risk (risk.ts), one-hop
                   import resolution for prompt context (callees.ts)
    logs/          wrapper around tools/log-analyzer
    prediction/    model-backed prediction: one file, or a whole project
    sourceFiles.ts shared source-tree walker
    types.ts       shared result types
  providers/       Claude Code / Codex CLI adapters + process spawning
  extension/       VS Code integration only
  mcp/             MCP stdio server
  test/            unit tests (Node built-in runner)
examples/
  bug-patterns/    deliberately broken files used for testing
tools/
  log-analyzer/    dependency-free Python log anomaly scorer
dist/              bundled output (esbuild) — the only thing shipped
```

The dependency direction is one-way: `extension/` and `mcp/` both depend on
`core/` and `providers/`, and never on each other. `core/` depends on nothing
editor-specific, which is why the same engine backs both surfaces.

## Status and caveats

Read this before relying on it.

- **Developed and manually verified on Windows.** CI builds and tests on Linux,
  macOS and Windows, but the CLI-discovery paths for macOS and Linux
  (`/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`) have not been
  exercised against a real install. The macOS branch of the Claude credential
  check assumes Keychain storage and reports "signed in" without verifying it —
  the connect flow's live check is what actually confirms the sign-in.
- **`predict_failures` sends file contents to a model provider.** It also sends
  the definitions of imported functions the file calls, resolved one level deep
  within the project, so the model can see whether a callee already handles the
  case it is about to flag; pass `calleeContext: false` to send only the file.
  Third-party packages are never read. The deterministic tools (`analyze_file`,
  `scan_project`, `analyze_logs`) run entirely locally and send nothing
  anywhere. If you point the MCP server at a private codebase, know which tools
  your agent is calling.
- **Very large files are analysed only in part.** Up to 120,000 characters
  (roughly 3,500 lines) are sent to the model; beyond that the verdict covers a
  prefix and says so. Files over 4 MB (~120,000 lines) skip static analysis
  entirely rather than being read into memory.
- **The static score is a heuristic, not a proof.** It counts structural risk
  factors — it does not know your invariants, and a high score is a hint about
  where to look, not a defect report.
- **Only JavaScript and TypeScript are analysed**, in these extensions: `.js`,
  `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`. Decorators parse, so
  Angular, Nest, TypeORM and MobX sources are analysed rather than skipped.
  Single-file components are not supported: a `.vue` or `.svelte` file is never
  read at all.
- **The benchmark is measured on generated corpora, not real repositories.**
  The headline figures in [bench/RESULTS.md](bench/RESULTS.md) come from 40
  generated JavaScript files with 6 planted defects across 4 defect classes. A
  smaller TypeScript corpus is measured separately (`npm run bench:ts`). Both
  were built alongside the tool by the same author, and the classifier prompt
  was revised in response to what they showed — so these are in-sample
  numbers. See the caveats in the report, which say which corpus drove which
  change.

## Security model

- **No credentials are handled.** The extension stores only the chosen provider
  id. Tokens stay with the CLI, which does its own auth. Nothing is read from
  `~/.claude/.credentials.json` or `~/.codex/auth.json` beyond checking that the
  file exists and is non-empty.
- **No shell is invoked.** Every child process is `spawn`ed directly with an
  argument array. Prompts and file contents travel over **stdin**, never argv.
  On Windows, npm's `.cmd` shims are routed through `cmd.exe` with quoting this
  project controls rather than `shell: true`.
- **The extension requires a trusted workspace** (`untrustedWorkspaces:
  supported: false`), and `predictiveDebugger.pythonPath` is machine-scoped so a
  repository cannot point the interpreter we execute at its own binary.
- **Analysed source is treated as untrusted data.** A file could contain text
  engineered to read as instructions. Claude runs with `--tools ""`, so it has
  no tools to misuse; `codex exec` has no equivalent switch and can still read
  files within its read-only sandbox, so the prompt marks the source explicitly
  as data and the parsed `reason`/`pattern` fields are length-capped. Prefer the
  Claude provider when analysing code you do not trust.
- **The MCP tools accept absolute paths from the calling agent** and will read
  any file the process can read — by design, since the point is to analyse a
  codebase. Files above 4 MB are skipped rather than loaded.
- `npm audit` reported 0 vulnerabilities across 111 production dependencies at
  the 0.2.0 release. Re-run it rather than trusting this line.

## Setup

```bash
npm install
npm run build     # type-check, then bundle to dist/
npm test
```

Both entry points ship as single bundled files, produced by esbuild:

| Output | Purpose |
| --- | --- |
| `dist/extension.js` | VS Code extension (`vscode` stays external) |
| `dist/mcp-server.js` | MCP stdio server, also exposed as the `predictive-debugger-mcp` bin |

`tools/` is not bundled — the log analyzer is a Python script spawned as a
separate process.

You also need at least one CLI installed and signed in:

```bash
npm i -g @anthropic-ai/claude-code   # then: claude
npm i -g @openai/codex               # then: codex login
```

## Using it in VS Code

Press <kbd>F5</kbd> to launch an Extension Development Host, then:

| Command | What it does |
| --- | --- |
| `Predictive Debugger: Connect` | Pick a CLI, verify the sign-in works |
| `Predictive Debugger: Predict Failures in Current File` | Analyse the open file |
| `Predictive Debugger: Predict Failures Across Project` | Rank the whole workspace |

Results land as diagnostics in the Problems panel and as a report in
**Output → Predictive Debugger**.

Use the *"Run Extension (bug-patterns test folder)"* launch configuration to
test the project-wide command — VS Code refuses to open a folder that is already
open in another window, so the dev host needs a different folder.

## Using it from an agent (MCP)

### Claude Code

A project-scoped `.mcp.json` is already committed (it points at `dist/mcp-server.js`, so run `npm run build` first), so from this directory:

```bash
claude
```

Claude Code picks up the server automatically. To register it globally instead:

```bash
claude mcp add predictive-debugger -- node /absolute/path/to/dist/mcp-server.js
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.predictive-debugger]
command = "node"
args = ["/absolute/path/to/dist/mcp-server.js"]
```

### Tools

The first three are **deterministic**: no model call, no credentials, results in
milliseconds. These are what a reviewing agent should reach for — the agent is
already a model, so it needs facts, not a second opinion.

| Tool | Purpose |
| --- | --- |
| `analyze_file` | Complexity metrics + risk score and risk density for one file, with the signals that drove it |
| `scan_project` | Rank every source file in a directory by risk density — risk per line, not per file |
| `analyze_logs` | Score log lines by severity and unusual wording, return the anomalies |
| `predict_failures` | Full pipeline including a second-opinion model verdict, an `actionable` precision gate, and a `checked` list of the categories the model says it weighed — spawns a CLI, 5–15s per file |
| `list_providers` | Which CLIs are installed and signed in (for diagnosing failures) |

`predict_failures` is deliberately the odd one out. When an agent calls it, one
model is asking another model to review code — worth it for an independent
second opinion, wasteful as a default. The description tells the calling agent
exactly that, so it reaches for `analyze_file` first.

A typical agent review looks like: `scan_project` to find the risky files →
read those files directly → optionally `predict_failures` on the one or two that
look worst.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `predictiveDebugger.claudeModel` | *(CLI default)* | Model alias for the Claude CLI |
| `predictiveDebugger.codexModel` | *(CLI default)* | Model for the Codex CLI |
| `predictiveDebugger.logFile` | *(none)* | Workspace-relative log file to fold into the score |
| `predictiveDebugger.pythonPath` | auto | Interpreter for the log analyzer |
| `predictiveDebugger.maxFiles` | `25` | Cap on files per project run — each costs one CLI call |

## How the score works

`combinedScore` is the model verdict, nudged by two local signals:

```
0.90 × model verdict   likelihood the CLI's model assigns to a concrete
                       failure, with a pattern name and line number
0.10 × static risk     AST complexity: nested loops, long functions,
                       async boundaries, unguarded mutation
0.15 × log anomalies   share of log lines flagged as unusual — folded in
                       only when a log file is supplied, with the other
                       two weights renormalised to make room
```

The verdict dominates on purpose. On the benchmark corpus the static score
separates buggy files from clean ones with an AUC of 0.33 — worse than a coin
toss, because complexity tracks file length and half the planted bugs sit in
short files. An earlier 0.4/0.4/0.2 blend pulled the combined score down to AUC
0.74 from the verdict's own 0.91 and ranked a clean 200-line service above four
of the six real defects; it also capped the score at 0.8 whenever no log file
was given, since the log term then contributed nothing.

The blend lives in `src/core/prediction/score.ts` as `combineScores`, separate
from the pipeline that calls it, so the weights can be tested without a model
call. Static risk and log analysis run locally and cost nothing. Only the model
verdict spawns a CLI.

Two static scores are reported, and they answer different questions.
`riskScore` is the weighted signal sum under a smooth saturation
(`x / (x + k)`) — how much is going on in this file. It grows with length, so
ranking by it is close to ranking by size (ρ = 0.83 against raw token count).
`riskDensity` divides the same signals by the length of the file and damps the
ones that accumulate with it — mutations, branches, cyclomatic complexity — to a
tenth of their weight. That is what `scan_project` orders by, because the agent
pays per token and a defect in a 14-line helper is nearly free to check.

Saturation rather than clamping matters for both: clamping made every
non-trivial file score exactly 1, which destroyed the ranking `scan_project`
exists to provide. Saturation is strictly monotonic, so heavier files always
compare correctly and the result still cannot exceed 1.

A file that cannot be parsed is reported with a `parseError` and a zero score
rather than throwing, and a project scan that fails on one file keeps the
results for the rest and lists the failures separately. Both behaviours are
covered by tests — they were originally bugs the test suite caught.

## Measured results

`bench/` holds a benchmark that puts numbers on the two questions worth asking:
does calling the tool actually cost a reviewing agent less context than reading
the file, and is the answer good enough to act on unread? Full write-up with
charts, including where the tool does badly, is in
**[bench/RESULTS.md](bench/RESULTS.md)**.

The report is rendered directly on GitHub and includes light/dark charts,
per-file outcomes, the score-threshold analysis, a provider comparison, the agent
A/B comparison, and the project-ranking results. The charts are Vega-Lite
specifications rendered to standalone SVG at build time — GitHub gives a
committed `.svg` no page CSS, so each one is written twice with literal colours
and paired in a `<picture>`. The underlying corpus and raw result files remain in
`bench/` so the figures can be inspected and reproduced, but that directory is
excluded from the published npm and VSIX packages.

To regenerate the benchmark artifacts from a cloned repository:

```bash
npm install
npm run build                    # build dist/mcp-server.js used by the benchmark
npm run bench                    # all four steps below, in order
npm run bench:ts                 # the smaller TypeScript corpus

node bench/generate-corpus.mjs   # generate the 40-file corpus and answer key
node bench/measure.mjs           # measure scan_project ranking quality
node bench/measure-file.mjs      # compare predict_failures with reading files
node bench/markdown.mjs          # rebuild RESULTS.md and its SVG charts
```

`measure-file.mjs` uses real model CLI calls. It honours `BENCH_PROVIDER`
(`claude` or `codex`) and `BENCH_TRIALS` (default: 3), so a full run takes a few
minutes and consumes model usage.

Headline, over 12 files with 3 trials each against the Claude CLI:

| | |
|---|---|
| Context to read the files | 10,244 tokens |
| Context to ask `predict_failures` | 1,606 tokens |
| Runs landing inside the defect's own function | 18 of 18 |
| Runs landing on the exact line | 12 of 18 |
| False alarms on clean files, raw output | **0 of 18** |
| Separation between buggy and clean runs (AUC) | 1.000 |

Two localisation numbers, because an agent and a Problems panel need different
ones: the enclosing function is where a reader would look, the exact line is
what a panel underlines. This replaced an earlier tolerance of three lines
either way, which accepted most of a 13-line file and called a defect with two
defensible sites a miss.

That 0.70 cutoff is now product behaviour, not just advice in this README. Replaying the
same 36 Claude responses changes VS Code Problems from **12 false alerts to 0**, while
surfacing **15 of 18** planted-bug runs instead of all 18. The MCP response exposes the
same decision as `actionable` and a four-state `status`: `actionable`, `uncertain`, `none`,
or `unavailable`. An uncertain result keeps its pattern, score, line and reason, but is
labelled “not added to Problems” instead of becoming an alert.

That replay measured the reporting gate alone. A provider-matched rerun measures the
prompt: with the evidence policy and the concurrency clause, Claude names **0 of 18**
defects in clean controls, down from 11, while naming all 18 planted lines. A
three-trial run through the Codex provider on the same build also produced **0 of 18
false alarms**, with 11 of 18 planted runs on the correct line. See the report for the
per-provider comparison.

Three findings that should change how the tools are used:

- **The answer costs a flat ~134 tokens**, so asking is only cheaper than
  reading for files above roughly that size. On an 80-token helper it still
  costs more.
- **The false alarms were fixed in the prompt, not the threshold.** An evidence
  policy that makes the model disprove a candidate before reporting it, plus a
  clause saying concurrency is a normal execution rather than an invented input,
  took clean-file alarms from 11 of 18 to 0 of 18. The 0.70 gate now costs
  nothing and catches nothing — keep it as a backstop, because the refusal is a
  model behaviour and not a guarantee. Earlier builds put clean-file noise as
  high as 0.65.
- **`scan_project` earns its keep only because it ranks by density.** Ordered by
  total risk the ranking tracked file size (Spearman ρ = 0.83 against raw token
  count) and beat neither directory order nor random order at any budget.
  Ordered by density (ρ = 0.36) it surfaces 4 of 6 planted bugs in the first 15
  files against 2 for directory order, and beats random at every budget. Two
  bugs still rank last: a missing null check in a 16-line mapper has no
  structural signature for any complexity heuristic to find.

A two-agent A/B on the same corpus: the tool-using agent spent 26% fewer tokens,
read no source at all, took the same wall-clock time, and found the same two of
three bugs. It was also the arm that correctly cleared the clean control — the
agent that read the code was the one that reported a defect there. Much less
than the 84% saving the per-file accounting suggests, because the agent's own
overhead dominates.

## Development

```bash
npm run watch     # esbuild in watch mode (unminified, with sourcemaps)
npm run check     # type-check only — esbuild does not type-check
npm test          # 84 tests, Node's built-in runner, no test dependencies
npm run package   # build and produce a .vsix
```

**esbuild does no type checking.** `npm run build` runs `tsc --noEmit` first for
exactly that reason, and CI runs them as separate steps so a type error is
distinguishable from a bundling error. Tests run against the `tsc` output in
`out/`, not the bundle.

Tests live in `src/test/`. They cover the pure logic — the risk model, AST
metrics, the score blend, model-reply parsing, Windows argument quoting, the
source-tree walker, and the log analyzer's degradation contract. Anything that
needs a signed-in CLI is deliberately not unit-tested;
`.github/scripts/check-mcp.mjs` covers the MCP surface end to end without
credentials.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for the setup, what CI checks, and how to change a number that the benchmark
backs.

For anything security-relevant, follow [SECURITY.md](SECURITY.md) and report it
privately rather than opening an issue.

## License

MIT — see [LICENSE](LICENSE).
