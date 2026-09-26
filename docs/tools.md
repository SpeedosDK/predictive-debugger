# Tool reference

[Back to README](../README.md#tools)

The MCP server exposes seven tools. Type checking, static analysis, dependency mapping and log
analysis run locally. Only `predict_failures` calls a model provider.

Source analysis supports `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts` and
`.cts`, including decorators. Vue and Svelte single-file components are excluded.
Files above 4 MB are rejected. Use absolute paths unless a parameter says otherwise.

## `scan_project`

Rank a directory's source files by `riskDensity`, the concentration of structural
risk signals per line. This helps choose where to read first; it does not report
confirmed defects.

| Parameter | Default | Purpose |
| --- | --- | --- |
| `directory` | Required | Directory to scan |
| `limit` | `50` | Maximum results, up to 500 |
| `includeTests` | `false` | Include test files in the ranking |
| `verbose` | `false` | Include raw metric counts |

Results include `scanned`, `returned`, `orderedBy` and ranked `files`. Paths are
relative to the scanned directory. Unreadable files are reported separately so
one failure does not discard the rest of the scan.

Tests are excluded by default because mocked awaits and other test structures
can rank highly without indicating production risk. Set `includeTests: true`
when reviewing the test suite itself.

## `analyze_file`

Pass `file` to get AST complexity metrics, `riskScore`, `riskDensity` and the
signals behind the scores. A parse failure returns `parseError` and a zero score;
that zero is not evidence that the file is safe.

## `check_types`

Pass `files` with up to 20 absolute paths from one project. Optional `project`
selects a `tsconfig.json` or `jsconfig.json`; otherwise the nearest config is
discovered. The bundled TypeScript compiler loads the complete config's root
files, preserving ambient declarations, aliases and inherited options. Only
selected files' diagnostics are returned. Nothing is emitted or executed, and
no provider is called. The reply still occupies the calling agent's context.

Without a config, `mode: "inferred"` uses ES2022, bundler module resolution,
JS checking, null checking and implicit-this checking on the selected roots.
Configured JavaScript checking and file-level opt-outs are respected. This is
compiler evidence under those settings, not proof of a runtime defect or safety.

Results include `compiler`, `project`, `checked`, `skipped`, `diagnostics`,
`contextIssues` and `truncated`. Each diagnostic has a code, message and source
position. Missing dependencies and invalid compiler options appear separately
as context issues. `status: "unavailable"` reports a config failure or limit;
it never means the files are clean.

Limits are 1,000 root files, 1,000 compiler reads, 4 MB per file, 32 MB total
reads and 100 returned diagnostics. Project references are currently unsupported;
select a leaf config. The compiler runs synchronously, so these size limits are
not a hard execution timeout. The package includes the compiler and its standard
declarations; a project-local TypeScript installation is not required.

## `map_dependencies`

Find a file's imports, reverse imports and tests connected through imports.
Each relationship has a `via` chain with paths, import kinds and source lines.
These are static file relationships; they do not establish runtime callers or
test execution coverage.

| Parameter | Default | Purpose |
| --- | --- | --- |
| `directory` | Required | Project directory; outside source is excluded |
| `file` | Required | Source file, absolute or relative to `directory` |
| `depth` | `1` | Import hops in each direction, from 1 to 3 |
| `limit` | `50` | Total neighbors across both lists, up to 200 |
| `maxFiles` | `1000` | Maximum discovered source files, up to 2,000 |

The map includes tests and follows ESM imports and re-exports, type import
expressions and literal dynamic imports. `test: true` follows test-path naming
conventions. CommonJS requires, import assignments and nonliteral dynamic
imports remain unresolved.

Build, vendor and hidden directories are excluded. The index refreshes on every
request. Work is bounded by 20,000 directory entries, 64 directory levels, 4 MB
per source file, 32 MB of source reads and 10,000 import references. Serialized
replies are capped at 32,000 characters.

| Field | Meaning |
| --- | --- |
| `unresolved` | Unresolved outgoing imports from the requested file |
| `coverage.unresolved` | Unresolved references across the scanned project |
| `issues` | Read and parse failures, plus scan-limit details |
| `coverage.scanLimited` | The scan reached a discovery or processing limit |
| `truncated` | Some reply entries were omitted |

A missing relationship in a partial scan is not proof of absence. The tool uses
no model calls, but its replies occupy the calling agent's context. See the
[local measurements](../bench/DEPENDENCY-MAP-CHECKPOINT.md).

## `analyze_logs`

Pass `logFile` to score log lines by severity and unusual wording, returning the
anomalies first. Optional `threshold` ranges from 0 to 1 and defaults to `0.5`.
Requires Python 3; see [setup](setup.md#provider-login).

## `predict_failures`

Combine static analysis with an independent verdict from a supported CLI's
model. Each file requires a model call and uses the provider's usage allowance.

| Parameter | Default | Purpose |
| --- | --- | --- |
| `file` | Required unless `files` is supplied | One source file |
| `files` | None | Non-empty batch of source paths; takes precedence over `file` |
| `concurrency` | `4` | Concurrent model calls, from 1 to 8 |
| `provider` | First installed CLI | `claude`, `codex` or `copilot` |
| `model` | CLI default | Model override passed to the provider |
| `calleeContext` | `true` | Include bounded imported definitions and referenced types |
| `multi` | `false` | Request all demonstrable findings; experimental |
| `logFile` | None | Log file to include in the combined score |
| `verbose` | `false` | Include static metrics and the full log breakdown |

Use `files` for a change set. Up to eight small files share a model call, with
the grouped prompt bounded at 120,000 characters. Large files run alone with
their existing source allowance. Groups run concurrently; lower `concurrency`
if the provider starts rate-limiting. Duplicate resolved paths are removed.

The reply contains `results` in input order and lists `failures` separately.
Each verdict is checked against its own file's source ranges. Missing, duplicate
or incomplete verdicts are unavailable, never clean. A file whose group verdict
names a defect with a score under 0.80 is reviewed again on its own, and that
verdict replaces the group's: grouped scores near the 0.70 gate were unreliable
in both directions. So is a file the group calls clean when it contains an async
function that awaits a read and later awaits a write, the shape of a lost update
that group replies missed. A failed CLI call affects its group and is not retried;
retry only files whose assessment failed or is unavailable.

### Reading a verdict

The reply includes `pattern`, `score`, `line`, `reason`, `status` and `actionable`.
Use `actionable` when deciding whether to present a prediction as a defect.

| `status` | Meaning |
| --- | --- |
| `actionable` | A reported defect has a model score of at least `0.7` |
| `uncertain` | A named defect scored below the reporting threshold. The reply adds `check`: read the cited lines and confirm or dismiss it |
| `none` | No defect reported |
| `unavailable` | No usable model verdict; this is not a clean result |

`checked` lists the bug categories the model says it considered. It is a
self-report, and an empty list means no coverage was reported. Additional
findings appear in `findings` when returned. The reporting threshold was measured
on single-finding replies, so `multi: true` is less well characterized.

Large files send at most 120,000 source characters, selected as whole
declarations with original line numbers. The reply discloses truncation;
omitted code remains unreviewed. There is no automatic second model pass.

### Dependency context

By default, the model also receives bounded supporting definitions from local
dependencies. Set `calleeContext: false` to send only the source file.
Third-party packages are never read for this context.

Supported cases include direct ESM imports, declared imported objects, referenced
types, imported constructors, named/default binding re-exports and unambiguous
`export *` barrels through at most four files. Local `tsconfig.json` path mappings
support relative config inheritance.

CommonJS exports, namespace re-exports, package-based config inheritance and
injected instance methods remain unresolved. Conflicting or unreadable wildcard
branches remain unknown. Each collection parses at most 24 dependency files,
each no larger than 4 MB. Each requested export has a 128-step traversal limit,
including cached paths.

The text budget follows source length, with a 1,000-character minimum and
16,000-character maximum. It includes at most 12 definitions of 3,000 characters
each. Oversized imported objects and static class members prioritize the called
member, referenced fields and helpers. Retained members stay in source order,
and omissions are marked. Dynamic definitions, duplicate overrides, inheritance
and decorators retain prefix truncation. This does not establish complete
state flow through the program.

### Reviewing code an agent just wrote

The server advertises the [review routing](../README.md#tools) in MCP
`instructions` and repeats a short reminder in each prediction's `review` field.
Some clients do not forward server instructions, so the result also carries it.

For changes spanning files, a sub-agent should receive the changed files and
intended behavior, review only that scope, and run in the background where the
host supports it. The sub-agent rule's benefit has not been measured. A clean
per-file prediction cannot establish that the feature meets its requirements.

## `list_providers`

Takes no parameters. Reports installed supported CLIs and their sign-in checks.
Some credential-store checks are provisional; a live CLI call confirms access.

## How the score works

`riskScore` measures accumulated structural signals such as nested loops, long
functions and async boundaries. `riskDensity` adjusts for file length and reduces
the influence of signals that accumulate with it. `scan_project` sorts by density.
Both scores use smooth saturation to stay within 0 to 1 without flattening every
complex file to the same maximum.

`combinedScore` is a separate blend used by the prediction pipeline:

| Input | Weight |
| --- | --- |
| Model verdict | `0.90` without logs |
| Static risk | `0.10` without logs |
| Log anomalies, when available | `0.15`; the other weights are scaled to total `0.85` |

The model verdict dominates. The `actionable` gate uses the model's score, not
`combinedScore`. The implementation is in
[`score.ts`](../src/core/prediction/score.ts) and
[`confidence.ts`](../src/core/prediction/confidence.ts).
See [benchmark results](../bench/RESULTS.md) for measurements and their limits.
