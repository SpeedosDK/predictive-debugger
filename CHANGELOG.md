# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Three changes driven by the benchmark in `bench/`, each with the measurement that
motivated it.

### Changed

- **The classifier prompt treats concurrency as a normal execution.** The evidence policy
  asks the model to disprove a candidate defect before reporting it, and a single
  sequential reading of a file always disproves a race condition — so the policy suppressed
  the planted race in all three trials. Stating that anything on a timer, in a polling loop,
  or exported as a service method can be re-entered before an earlier call finishes recovers
  it at no cost to precision: still 0 of 18 false alarms, planted lines named up from 14 to
  15 of 18, buggy files reported clean down from 3 to 0, and separation (AUC) from 0.917 to
  1.000. The bill is latency, 4.9 s to 6.2 s per file. A local variable accumulated inside
  one invocation is explicitly exempt, so ordinary loop accumulators do not start reading as
  shared state.
- **Predictions are precision-gated before they become user-visible defects.** VS Code
  now creates a Problem only for a model verdict at or above 0.70, and summaries call
  lower scores "no high-confidence failure" instead of repeating a speculative bug.
  `predict_failures` exposes the same decision as `actionable`, plus an explicit `status`
  (`actionable`, `uncertain`, `none`, or `unavailable`). Uncertain results retain their
  pattern, score, line, and reason in the output but are labelled as not added to Problems.
  Replaying the same 36 Claude responses cuts
  false Problems from 12/18 to 0/18, with actionable planted-line hits moving from 18/18
  to 15/18. A fresh current-build Codex run produced 0/18 false alarms and 11/18
  actionable planted-line hits.
- **The classifier now requires local evidence.** Hypothetical malformed inputs,
  dependency results that violate their normal contract, and an awaited rejection merely
  propagating to its caller are no longer enough to claim a defect. Wrong return values
  and side effects still count when documentation or local control flow establishes the
  contract.
- **`scan_project` ranks by risk density instead of total risk.** The total grows
  with file length, so ranking by it was close to ranking by size (Spearman
  ρ = 0.83 against raw token count) and put the two smallest planted bugs 38th and
  39th of 40. Density divides the signals by the length of the file and damps the
  ones that accumulate with it — mutations, branches, cyclomatic complexity — to a
  tenth of their weight. On the benchmark corpus the planted bugs move from ranks
  11, 14, 17, 38, 39, 40 to 4, 9, 11, 12, 39, 40; at a budget of 15 files the
  ranking now surfaces 4 of 6 bugs against 2 before, and beats random ordering at
  every budget instead of none. `riskScore` is unchanged and still reported.
- **`combinedScore` is now 0.9 × model verdict + 0.1 × static risk**, with log
  anomalies folded in at 0.15 only when a log file is supplied and the other
  weights renormalised. The old 0.4/0.4/0.2 blend let a complexity score that
  separates buggy from clean files with an AUC of 0.33 — worse than chance —
  outvote a verdict with an AUC of 0.91, dragging the combined figure to 0.74 and
  ranking a clean 200-line service above four of six real defects. It also capped
  the score at 0.8 whenever no log file was given.
- **`predict_failures` and `scan_project` return a much smaller payload.** The
  verdict was about a fifth of the `predict_failures` reply; the rest was the
  static metric block, a log stanza reporting that log analysis had not been
  requested, and the absolute path the caller had just supplied. Metrics and logs
  now sit behind a `verbose` flag, the path is echoed as given, and `scan_project`
  reports paths relative to the directory it was asked about. Scan output for the
  40-file benchmark corpus fell from 6,512 to 3,307 tokens.

### Added

- **The report's charts are Vega-Lite specifications** rendered to standalone SVG at build
  time, replacing hand-written SVG strings. The layout arithmetic — tick placement, label
  collision, legend offsets — was being maintained by hand for every new chart. The two
  literal light/dark palettes and the `<picture>` pairing are unchanged, and the output is
  still deterministic, so the committed SVGs only move when the data does.
- **A provider comparison** (`bench/RESULTS.md` section 4, `charts/providers.*.svg`)
  showing planted lines found and false alarms raised for each CLI, raw and after the
  actionable gate.
- **A before/after section in `bench/RESULTS.md`**, with `bench/baseline.json` holding
  the measurements from commit 3c633b1 so both columns are read out of result files
  rather than typed by hand.
- **Separation (AUC) reported by `bench/measure-file.mjs`** for all three scores, so
  "which number should an agent gate on" is answered by the harness. Current run:
  `score` 0.96, `combinedScore` 0.95, `riskScore` 0.33.
- `riskDensity` on `StaticAnalysis`, and `lines` on `FileMetrics`.
- `verbose` input on `predict_failures` and `scan_project` for the full payload.
- `npm run bench` to run the four benchmark steps in order.

### Fixed

- `bench/measure-file.mjs` no longer replaces the last valid result file when every
  provider call fails, and `BENCH_OUTPUT` can keep provider-specific validation runs
  separate. This was found when the Claude CLI hit its session limit during the
  post-tuning rerun.
- **The recommended score threshold no longer sits on the noise.** The lowest cut with
  no false alarms is refitted every run — 0.65, 0.60 and 0.70 across three runs of the
  same trials — and the A/B in section 4 was given 0.60 and immediately reported a
  defect in a clean file that scored exactly 0.60. The report now recommends a gate a
  step above the highest clean score observed in any run, and says why.
- `gpt-tokenizer` is declared as a devDependency. The benchmark scripts imported
  it, so the documented "run it yourself" steps failed on a clean checkout.
- A handful of em dashes in this file were stored as CP-1252 bytes rather than
  UTF-8, so they rendered as replacement characters.

## [0.1.0] — 2026-08-17

First public release. Pre-1.0 because macOS and Linux are covered by CI but have
not been exercised against a real CLI installation — see the caveats in the
README.

### Added

- **VS Code extension** with three commands: connect to a CLI, predict failures
  in the current file, and rank an entire project. Results appear as diagnostics
  in the Problems panel and as a report in the output channel.
- **MCP server** (`out/mcp/server.js`) exposing five tools to coding agents:
  - `analyze_file`, `scan_project`, `analyze_logs` — deterministic, local, no
    model call and no credentials
  - `predict_failures` — full pipeline including a model verdict from the
    signed-in CLI
  - `list_providers` — installation and sign-in diagnostics
- **CLI-borrowed authentication.** Model access comes from the Claude Code CLI
  or Codex CLI the user is already signed in to. The extension never reads,
  stores, or transmits a token; only the chosen provider id is persisted.
- **Static analysis** producing complexity metrics, a heuristic risk score, and
  the ranked signals that produced it.
- **Dependency-free log analyzer** (`tools/log-analyzer/analyze_logs.py`) that
  scores lines by severity and vocabulary rarity using only the Python standard
  library.
- Test suite of 48 tests on Node's built-in runner, with no test dependencies.
- CI across Linux, macOS and Windows on Node 22 and 24, including an end-to-end
  MCP smoke check that needs no credentials.
- esbuild bundling for both entry points. The packaged extension went from 1805
  files / 2.63 MB to 10 files / 496 KB, which removes the extension-host startup
  cost of resolving ~1000 loose JavaScript files.

### Changed

- Replaced the OAuth/PKCE and API-key sign-in flows with CLI-based connection.
- Replaced embedding-similarity bug matching with a prompt-based classifier that
  returns a pattern, a line number and a reason — the CLIs expose a chat
  interface, not an embeddings endpoint.
- Rewrote the log analyzer, which previously required an OpenAI API key and
  numpy, contradicting the point of borrowing the CLI's sign-in.

### Security

- The extension declares `untrustedWorkspaces: supported: false`, and
  `predictiveDebugger.pythonPath` is machine-scoped — a repository cannot point
  the interpreter that gets executed at a binary of its own choosing.
- Analysed source is framed as untrusted data in the prompt, and the model's
  `pattern`/`reason` fields are length-capped. Claude runs with `--tools ""`;
  `codex exec` has no equivalent switch, so the boundary is stated explicitly.
- Files above 4 MB are skipped rather than read into memory, since the MCP tools
  accept arbitrary paths from the calling agent.

### Fixed

- **The risk score saturated at 1 for every non-trivial file**, which made
  `scan_project`'s ranking useless on real code — the flagship agent tool could
  not distinguish a 700-line module from a 40-line one. The hard clamp is
  replaced with a smooth, strictly monotonic saturation, so heavy files always
  compare correctly. Found by running the tool on its own source.
- **Silent prompt truncation.** Source sent to the model was capped at 24,000
  characters — about 700 lines at typical density — so a verdict on any larger
  file was based on a prefix with no indication given. The cap is now 120,000
  characters (~3,500 lines) and truncation is reported on the prediction, in the
  diagnostic and in the output channel.
- A file that cannot be parsed no longer throws. Babel's `errorRecovery` does
  not handle unbalanced braces, so `analyzeSource` now reports a `parseError`
  with a zero score instead of aborting.
- A project scan no longer discards all results when one file fails. Failures
  are collected separately and reported alongside the successful analyses.
- `combinedScore` treated a clean log score as high risk. Log health is now
  inverted into a risk contribution.
- The extension bundle could not be loaded: `"type": "module"` in `package.json`
  conflicted with the CommonJS output required by the extension host.
- `@types/vscode` was newer than the declared `engines.vscode`, which prevented
  packaging and allowed use of APIs missing from the minimum supported version.

[Unreleased]: https://github.com/SpeedosDK/predictive-debugger/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SpeedosDK/predictive-debugger/releases/tag/v0.1.0
