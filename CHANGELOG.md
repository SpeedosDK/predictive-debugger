# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] â€” 2026-08-17

First public release. Pre-1.0 because macOS and Linux are covered by CI but have
not been exercised against a real CLI installation â€” see the caveats in the
README.

### Added

- **VS Code extension** with three commands: connect to a CLI, predict failures
  in the current file, and rank an entire project. Results appear as diagnostics
  in the Problems panel and as a report in the output channel.
- **MCP server** (`out/mcp/server.js`) exposing five tools to coding agents:
  - `analyze_file`, `scan_project`, `analyze_logs` â€” deterministic, local, no
    model call and no credentials
  - `predict_failures` â€” full pipeline including a model verdict from the
    signed-in CLI
  - `list_providers` â€” installation and sign-in diagnostics
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
  returns a pattern, a line number and a reason â€” the CLIs expose a chat
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
