# Tool reference

[Back to README](../README.md#tools)

The MCP server exposes six tools. Static analysis, dependency mapping and log
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
| `concurrency` | `4` | Concurrent batch predictions, from 1 to 8 |
| `provider` | First installed CLI | `claude`, `codex` or `copilot` |
| `model` | CLI default | Model override passed to the provider |
| `calleeContext` | `true` | Include bounded imported definitions and referenced types |
| `multi` | `false` | Request all demonstrable findings; experimental |
| `logFile` | None | Log file to include in the combined score |
| `verbose` | `false` | Include static metrics and the full log breakdown |

Use `files` for a change set. Predictions run concurrently, with duplicate
resolved paths removed. The reply contains `results` in input order and lists
individual `failures` separately. A batch still makes one model call per unique
file; lower `concurrency` if the provider starts rate-limiting.

### Reading a verdict

The reply includes `pattern`, `score`, `line`, `reason`, `status` and `actionable`.
Use `actionable` when deciding whether to present a prediction as a defect.

| `status` | Meaning |
| --- | --- |
| `actionable` | A reported defect has a model score of at least `0.7` |
| `uncertain` | A possible defect falls below the reporting threshold |
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
