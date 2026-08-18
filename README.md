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
    analysis/      AST metrics (ast.ts) and the heuristic risk score (risk.ts)
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
- **`predict_failures` sends file contents to a model provider.** The
  deterministic tools (`analyze_file`, `scan_project`, `analyze_logs`) run
  entirely locally and send nothing anywhere. If you point the MCP server at a
  private codebase, know which tools your agent is calling.
- **Very large files are analysed only in part.** Up to 120,000 characters
  (roughly 3,500 lines) are sent to the model; beyond that the verdict covers a
  prefix and says so. Files over 4 MB (~120,000 lines) skip static analysis
  entirely rather than being read into memory.
- **The static score is a heuristic, not a proof.** It counts structural risk
  factors — it does not know your invariants, and a high score is a hint about
  where to look, not a defect report.
- Only JavaScript and TypeScript are analysed.

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
- `npm audit` reports 0 vulnerabilities across 111 production dependencies.

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
| `analyze_file` | Complexity metrics + risk score for one file, with the signals that drove it |
| `scan_project` | Rank every source file in a directory by risk, worst first |
| `analyze_logs` | Score log lines by severity and unusual wording, return the anomalies |
| `predict_failures` | Full pipeline including a second-opinion model verdict — spawns a CLI, 5–15s per file |
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

`combinedScore` blends three signals:

```
0.4 × static risk      AST complexity: nested loops, long functions,
                       async boundaries, unguarded mutation
0.4 × model verdict    likelihood the CLI's model assigns to a concrete
                       failure, with a pattern name and line number
0.2 × log anomalies    share of log lines flagged as unusual
```

Static risk and log analysis run locally and cost nothing. Only the model
verdict spawns a CLI.

The static component applies a smooth saturation (`x / (x + k)`) to the weighted
signal sum rather than clamping it. Clamping made every non-trivial file score
exactly 1, which destroyed the ranking `scan_project` exists to provide;
saturation is strictly monotonic, so heavier files always compare correctly and
the result still cannot exceed 1.

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
per-file outcomes, the score-threshold analysis, the agent A/B comparison, and
the project-ranking results. The underlying corpus and raw result files remain
in `bench/` so the figures can be inspected and reproduced, but that directory
is excluded from the published npm and VSIX packages.

To regenerate the benchmark artifacts from a cloned repository:

```bash
npm install
npm run build                    # build dist/mcp-server.js used by the benchmark
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
| Context to read the files | 10,228 tokens |
| Context to ask `predict_failures` | 2,991 tokens |
| Runs that named the planted line (±3) | 17 of 18 |
| False alarms on clean files, raw output | 13 of 18 |
| False alarms at `score >= 0.65` | 0 of 18 |

Three findings that should change how the tools are used:

- **The answer costs a flat ~250 tokens**, so asking is only cheaper than
  reading for files above roughly that size. On a 90-token helper it costs more.
- **`score` separates real defects from generic remarks.** The planted bugs
  score 0.70–0.90; the "this could be null if the caller passes null" noise tops
  out at 0.60. Agents should gate on it. The exact cut-off is fitted to this
  corpus and needs re-testing on unseen code.
- **`scan_project`'s ranking tracks file size** (Spearman ρ = 0.82 against raw
  token count) and does not beat reading the tree in directory order at any
  budget. It is a complexity heuristic, and half the planted bugs live in small
  files.

A two-agent A/B on the same corpus reached identical verdicts in both arms, with
the tool-using agent spending 26% fewer tokens — much less than the 71% the
per-file accounting suggests, because the agent's own overhead dominates.

## Development

```bash
npm run watch     # esbuild in watch mode (unminified, with sourcemaps)
npm run check     # type-check only — esbuild does not type-check
npm test          # 48 tests, Node's built-in runner, no test dependencies
npm run package   # build and produce a .vsix
```

**esbuild does no type checking.** `npm run build` runs `tsc --noEmit` first for
exactly that reason, and CI runs them as separate steps so a type error is
distinguishable from a bundling error. Tests run against the `tsc` output in
`out/`, not the bundle.

Tests live in `src/test/`. They cover the pure logic — the risk model, AST
metrics, model-reply parsing, Windows argument quoting, the source-tree walker,
and the log analyzer's degradation contract. Anything that needs a signed-in CLI
is deliberately not unit-tested; `.github/scripts/check-mcp.mjs` covers the MCP
surface end to end without credentials.

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a PR.

## License

MIT — see [LICENSE](LICENSE).
