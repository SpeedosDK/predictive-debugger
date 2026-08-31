# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The server now ships the fix-verification rule itself**, as MCP
  `instructions` plus an `onFix` hint on `predict_failures` replies that clear
  the precision gate. It asks the calling agent to have a non-mechanical fix
  reviewed from outside the context that produced it — a sub-agent where the
  host has them, otherwise a fresh `predict_failures` on the edited file.

  An agent that has just written a fix is the worst-placed reader of it: the
  reasoning that made the fix look right is still in its context, so reviewing
  it from the same seat re-derives the first conclusion instead of testing it.
  An independent pass catches defects the author's pass structurally cannot.
  Left to the agent's judgement this happened on some runs and not others;
  left to each user's project instructions it reached only the users who
  already knew about the failure mode.

  It is a floor, not a ceiling — the agent may verify more often, and a
  mechanical fix is exempt so a typo does not cost two model passes. The hint
  is duplicated on the wire because `instructions` is sent once at initialize
  and not every client forwards it to the model, while a tool result always
  reaches it; gating it on `actionable` keeps a clean file's reply free of it.

## [0.4.0] — 2026-08-31

### Added

- **GitHub Copilot CLI as a third provider** (#14). `copilot` now sits behind
  the same `CliProvider` interface as Claude Code and Codex: pick it in
  *Predictive Debugger: Connect*, or pass `provider: "copilot"` to
  `predict_failures`. Auth is borrowed the same way — from `/login`, from the
  gh CLI's token, or from `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` —
  and no token is ever read by this extension.

  The prompt is piped in on stdin rather than passed as `copilot -p <text>`,
  because a prompt carrying up to 120,000 characters of source does not fit on
  a command line on any platform; piped input is a full non-interactive turn as
  long as `-p` is absent. The turn runs with `shell`, `write` and `url` denied,
  built-in MCP servers disabled, and `ask_user` off, which leaves Copilot the
  same read-only footing as `codex exec`.

  Sign-in state is a hint, not proof: `/login` stores its token in the system
  credential store, which this extension does not read, so the connect flow's
  live prompt remains what actually confirms it. Model override:
  `predictiveDebugger.copilotModel`.

## [0.3.1] — 2026-08-30

### Fixed

- **The benchmark's exact-line score was grading against one anchor when the
  corpus already recorded several.** `isNear` has graded against
  `acceptableLines` since the enclosing-function change, on the stated grounds
  that a defect with two loci has two correct answers and the anchor the corpus
  author typed first is not privileged among them. `exactLine` never got the
  same treatment — it stayed a strict `predictedLine === plantedLine` — so a
  model that switched between two equally correct sites read as a regression.
  That is exactly what the 0.3.0 entry below recorded as a drop from 12→9 and
  17→15. Re-grading the same recorded runs against `acceptableLines` gives 15
  and 18; re-grading the pre-#13 runs the same way gives 15 and 18 as well.
  Like for like, exact-line accuracy did not move. The measurement did.

  Three labels were widened to match, each a defect whose two loci sit on
  different lines: `pricingService.js` now accepts the dereference that throws
  (36) as well as the out-of-bounds read that feeds it (34); the lost update in
  `reconciliationWorker.js` accepts the write the stale value lands in (40) as
  well as the read that goes stale (28); and `cache.service.ts`, which already
  accepted the teardown body, now also accepts the `onModuleDestroy`
  declaration, since that is the line a reader is told never releases the timer.
  `alsoAnchor` takes a list rather than a single anchor to allow it. Runs now
  carry `acceptableLines`, so a recorded result can be re-graded without the
  manifest it came from.

  This does not settle which line the Problems panel should underline. It says
  the benchmark should not decide it by accident.

- **`auditService.js` was not a clean control.** The `service()` generator
  emitted methods that initialise `total` to 0, await three values, use none of
  them, and return `{ id, total }` — an unconditionally zero result and three
  dead fetches, whenever it was parameterised with no loops. The tool reported
  it, correctly, at score 0.75 in two of three trials, and the answer key scored
  that as a false alarm. It is the same trap as the duplicated member names
  fixed earlier in the same file: filler that accidentally contains a bug
  measures the benchmark rather than the tool.

  A method with no loop now folds what it fetched into the total instead of
  discarding it. Three generated files change (`auditService`, `customerService`,
  `notificationService`); no file carrying a planted defect is touched. Clean
  controls go from 16 of 18 to **18 of 18**, and separation from 0.988 to
  **1.000**.

  Worth stating plainly: this defect predates every measurement in this file. The
  0.3.0 entry below records 18 of 18 true negatives on this corpus, and that run
  simply did not happen to flag `auditService.js` — the file was already broken.
  Clean-file behaviour varies more between runs than a single three-trial run can
  establish, so the claim that the callee context "fixed" the one recorded false
  alarm is weaker than it reads there.

### Changed

- **MCP replies are no longer pretty-printed.** The reader is a model and every
  space in a two-space indent is billed to it: 46 of the 161 tokens in a typical
  `predict_failures` reply, 29% of the response, spent on making a raw transcript
  pleasant for a human who is not the audience. Arrays were the worst of it —
  `checked` put each pattern id on its own indented line, which is most of what
  that field appeared to cost when it was added. The tool is worth calling
  instead of reading the file only while the answer is much smaller than the
  file, so the response budget is the product rather than a detail of it. No
  field changed; only the whitespace between them.

  Measured across both corpora: the mean reply fell from 177 to 129 tokens on
  `bench/corpus` and from 169 to 126 on `bench/corpus-ts`, a 27% cut. That is
  below where the reply sat before 0.3.0 (134 and 133) while still carrying the
  `checked` field and the callee context that had pushed it up — so the ~30%
  those added is repaid, with interest, and the README's cost-per-answer figure
  is right again rather than merely stale.

## [0.3.0] — 2026-08-30

### Added

- **`predict_failures` can return a ranked list of findings per file** instead of
  one verdict, behind `multi: true` on the MCP tool and
  `predictiveDebugger.multipleFindings` in the extension. One finding per file
  meant fixing the reported issue and calling again to see whether there was
  another, at 5–15 seconds a call. Off by default because it is not a free win:
  more findings per call is also more surface for a false positive per call, and
  the precision gate in `confidence.ts` was measured on single-verdict replies.
  The gate now applies per finding rather than per file, the Problems panel gets
  one diagnostic per finding, and `findings` appears in the MCP response whenever
  a reply carried more than one — including when `multi` was not set, since
  dropping a volunteered second defect is the behaviour this replaces.
  Unmeasured: whether asking for a list costs precision is a benchmark question,
  and `bench/measure-file.mjs` now records the finding count so it can be
  answered from a normal run. Resolves #7.

- **`predict_failures` reports which bug categories were checked**, not only
  which one was found. Nothing in the response distinguished "I checked for this
  and found nothing" from "I never considered it": both come back as
  `pattern: "none"`, `score: 0`. The new `checked` field lists the catalogue ids
  the model says it weighed, always present in the MCP response and empty when
  the model reported none. It is a self-report, not a proof — it makes coverage
  visible instead of assumed, which is what makes a bias like the
  `race_condition` monoculture legible in the reply rather than silent. Distinct
  from `status: "unavailable"`, which continues to mean no verdict could be
  parsed at all. Resolves #12.

- **The classifier prompt carries the definitions of functions the file calls**,
  resolved one level deep through relative imports. The motivating false
  positive was attributable to single-file scope entirely: the disproof of the
  reported claim was that a callee was idempotent, and that callee was one
  import away, so the model had no way to see it. The evidence policy already
  asks the model to disprove a candidate before reporting it; this gives it the
  material to do so instead of assuming the worst about code it cannot see. One
  hop only, relative specifiers only — `node_modules` is never read — and both
  the per-callee and the total size are capped, so the added cost is bounded at
  roughly an eighth of what a large file already costs. Off via
  `calleeContext: false` on `predict_failures`. Resolves #4.

  Measured on `bench/corpus` and `bench/corpus-ts` after this change (see
  `bench/RESULTS.md`): function-level hit rate held at 18 of 18 planted defects on
  both corpora, and the one false alarm in the TypeScript corpus (`lib/headers.mts`,
  17 of 18 true negatives before) did not reproduce — 18 of 18 after. Exact-line
  accuracy dropped on both corpora (JS 12→9, TS 17→15), entirely on three files
  where the model now names a different line inside the same already-correctly-
  identified function — `reconciliationWorker.js`, `pricingService.js`, and
  `cache.service.ts`. Nothing moved to a wrong function or a false alarm. Tool
  tokens per call rose ~30% (JS 4,816→6,369, TS 4,782→6,095), matching the added
  callee context and the `checked` field from #12. Net: no regression on the
  metrics the product gates on, a real fix to the one recorded false positive, at
  a real token cost — worth shipping on by default, worth re-measuring if the
  exact-line drop turns out to matter to anyone reading the Problems panel rather
  than an agent.

### Changed

- **The model-reply parser recovers more from a truncated response.** It cut at
  the last top-level comma, a rule written for one object, which threw away
  complete findings when a list was cut off two levels down. It now cuts back to
  the last value boundary at any depth and closes whatever is still open, so a
  reply that stops inside the third finding keeps the first two, and a verdict
  whose `checked` list was cut mid-id keeps the ids that did arrive. Nothing is
  invented: everything before the cut is what the model sent.
- **`BugPrediction` is one finding; `BugAssessment` is what a call establishes
  about a file.** `checked` and `truncated` moved to the assessment, because both
  describe the examination rather than any defect it turned up, and
  `FilePrediction.aiPrediction` became `FilePrediction.ai`.

## [0.2.0] — 2026-08-29

Changes driven by the benchmark in `bench/`, each with the measurement that
motivated it, plus the housekeeping a first public repository needs.

### Changed

- **A prediction is graded against the function the defect lives in**, not a tolerance of
  three lines. The tolerance measured the wrong thing in both directions. On `lib/retry.js`,
  thirteen lines long, it accepted most of the file, so a prediction landed inside it by
  luck. On a defect with two defensible sites, the acquisition of a resource and the teardown
  that fails to release it, it called a correct answer a miss. `bench/enclosing-function.mjs`
  derives the range from the source, skipping single-line callbacks so the unit is the method
  a reader would open. The exact-line count is reported alongside it, and the two disagree:
  18 of 18 inside the function, 12 of 18 on the line itself.
- **The pattern catalogue has an `other` id.** It was a closed list of six, and a closed
  list threw away correct answers: asked about a method filtering on `createdAt` where its
  own documentation promises every record edited since a timestamp, the model named the
  line, explained the contradiction, then had to answer `none` because nothing fitted, and
  `parsePrediction` forces the score to 0 for `none`. That happened on every trial of both
  defects planted outside the catalogue in the TypeScript corpus, five of fifteen buggy runs.
  Adding `other` recovered all five. It also started reporting duplicated dead code on the
  JavaScript corpus, which the model itself described as "redundant but not itself a runtime
  failure", so the prompt now states that `other` is for runtime failures and not for
  maintainability.
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

- **The corpus generator gives every member a distinct name.** Both word lists held eight
  entries and every name was built from a single index into both, so a class with more than
  eight members defined the same method twice: eight duplicated names of nineteen members in
  `adminController.js`, eight of eighteen in `orderRepository.js`. Those are clean controls,
  and the duplication is a real defect the tool reports, so the answer key called a correct
  finding a false alarm. It also padded the "cost of reading the file" baseline with dead
  code. It confused five separate measurements before it was found.
- **A partial provider outage no longer destroys the measured results.** The guard fired only
  when every call failed. A session limit reached partway through let 21 of 36 calls fail,
  which emptied the control group entirely and still counted as a run, replacing the previous
  results. Any failure now writes to a `.partial.json` sidecar and leaves the measured file
  alone.
- **The source sent to the model carries line numbers.** The prompt asked for a 1-based
  line number and sent raw source, leaving the model to count newlines by eye. It described
  the defect correctly and then reported a line six to twelve lines away on the two largest
  files with a planted defect: five of eighteen runs. Small files were exact, which is the
  signature of a counting problem rather than a reasoning one. The size cap now applies to
  the numbered text, so numbering cannot push the prompt past the bound the cap exists to
  enforce.
- **A verdict cut off mid-reply is recovered instead of discarded.** `extractJsonObject`
  took everything from the first `{` to the last `}` and gave up when `JSON.parse` failed,
  so a complete verdict followed by a truncated key was thrown away as `unknown` and scored
  as a missed defect. It now closes the object at the last finished pair, and accepts the
  reconstruction only when it carries both a pattern and a score.
- **Decorated classes no longer fail to parse.** `@Injectable()` produced a parse error,
  which zeroed a file's metrics and sank it to the bottom of the `scan_project` ranking, so
  the tool recommended reading a Nest or Angular project's controllers and services last.
  The verdict from `predict_failures` was unaffected, since the model receives the raw
  source either way. Enabling `decorators-legacy` and `decoratorAutoAccessors` covers
  Angular, Nest, TypeORM, MobX and the `accessor` keyword.
- **Class and object methods are counted as functions.** Babel does not report a method as
  a `FunctionExpression`, so the metric visitor was blind to every method in a class-based
  codebase. `longFunctions` carries 0.15 of the risk weight and had never fired once across
  the 40 files of the benchmark corpus. The ranking on that corpus is unchanged, since its
  generated methods are all short, and the rank correlation between `riskDensity` and raw
  file size improved from 0.359 to 0.326.
- **`.mts` and `.cts` files are found by a scan.** They were the only TypeScript extensions
  missing from the source walker.
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
- **The score blend is its own module.** `combineScores` moved out of
  `predictFile` into `core/prediction/score.ts`. It was a private function
  reachable only through a live model call, so the weighting the README devotes a
  section to had no test at all; it now has five. The blend is unchanged except
  that out-of-range and non-finite inputs clamp to `[0, 1]` instead of only being
  capped above. The JSDoc for `predictFile` had also drifted onto the private
  function below it.
- **The MCP server reports the version from `package.json`.** It announced
  `1.0.0` over the wire while the package was `0.1.0`. esbuild now injects the
  real value, so there is one number rather than two.
- **`prepack` builds before packing.** `vscode:prepublish` covered `vsce` but
  nothing covered `npm publish`, so publishing without a manual build would have
  shipped a stale `dist/` — or an empty package, since `dist/` is git-ignored.
- `dist/extension.js` is excluded from the npm tarball. An MCP consumer never
  loads the VS Code bundle; the package drops from 515 kB to 335 kB.
- `SECURITY.md`, `CONTRIBUTING.md`, issue templates and a pull request template.
- **The benchmark report states that its numbers are in-sample.** The corpora
  were built alongside the tool and the classifier prompt was revised against
  them, which the per-corpus caveats said and the headline did not.
- Corrected figures in the README that had fallen behind the benchmark: the
  headline context table, the clean-control counts, the flat answer cost, and the
  test count. The README also still described localisation with the ±3-line
  tolerance that this release replaced with enclosing-function grading, and
  claimed no TypeScript had been measured after `npm run bench:ts` was added.

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

[Unreleased]: https://github.com/SpeedosDK/predictive-debugger/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/SpeedosDK/predictive-debugger/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/SpeedosDK/predictive-debugger/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SpeedosDK/predictive-debugger/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SpeedosDK/predictive-debugger/releases/tag/v0.1.0
