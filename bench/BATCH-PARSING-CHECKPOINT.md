# Batch dependency parsing checkpoint

Shared dependency caching is deferred. The existing cases show duplicate work,
but the measured parsing and indexing cost is too small to justify adding a cache
for this workload. No production caching or prediction behavior changed.

## Method

`batch-parsing-checkpoint.mjs` runs the real `predictFiles` pipeline with a local
response stub. It uses all 37 prediction targets from the existing JavaScript,
TypeScript and accuracy manifests, both as their three existing groups and as one
combined batch. Each workload runs with concurrency 1 and the production default
of 4, for 15 measured trials per arm after warmup. Arm order alternates.

One bundle contains unchanged source. A second uses build-time instrumentation
to record dependency reads, export indexing and synchronous AST parsing. Both
execute the same work; neither contains a shared cache. Every measured pair must
produce identical prompt hashes and full result hashes, and zero failed files.
The stub's clean responses are not accuracy evidence.

The result records bundle, runner, manifest and corpus hashes, Node version, CPU,
individual measurements and prompt hashes. Production source files are untouched.
The compile, build and real six-tool MCP smoke check passed before measurement.

## Results

Medians from `results-batch-parsing-final.json`, measured on Windows with Node
24.13.0. Times are milliseconds. Preparation includes file reading, static
analysis, dependency context, prompt construction and processing the local stub.
It excludes real provider latency.

| Workload | Files | Concurrency | Uninstrumented preparation | Dependency indexes / unique files | Repeated parse time | Repeated index time, including parsing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| JavaScript main | 12 | 4 | 22.02 | 0 / 0 | 0 | 0 |
| Accuracy | 13 | 4 | 15.93 | 21 / 10 | 0.82 | 0.97 |
| TypeScript main | 12 | 4 | 18.84 | 0 / 0 | 0 | 0 |
| All targets | 37 | 4 | 51.09 | 21 / 10 | 0.67 | 0.76 |
| All targets | 37 | 1 | 84.96 | 21 / 10 | 0.66 | 0.76 |

The combined batch repeated 11 dependency reads/indexes. Their cumulative read
duration was 4.24 ms with four workers, and 1.60 ms with one worker. Async read and
index durations include waiting and can overlap across workers. They are not
additive wall-time savings. Parsing is included in indexing and must not be
counted twice. Stat calls, alias configuration parsing and module resolution are
not timed separately.

The profiled combined batch took 51.64 ms with four workers versus 51.09 ms for
the unchanged bundle. This is an instrumentation comparison, not a cache speedup.
The raw file's plain-arm counters are uninstrumented placeholders; use the
profiled arm for counts. First-run measurements are retained separately, but the
arms share a process and OS filesystem cache, so they are not isolated cold starts.

All paired prompt and result checks passed. External provider calls and billed
tokens were zero. This experiment does not measure model accuracy, actual provider
token usage or overall agent workflow speed. A future cache should preserve exact
prompts; sharing local parsed data alone would not reduce prompt token counts.

## Decision and limits

Keep the current per-file cache. Less than one millisecond of repeated dependency
indexing in the combined batch is weak justification for batch cache lifetime,
concurrent request deduplication and memory management. The measured read work is
also small. There is no observed cache speedup because no cache was implemented.

The corpus has only 10 loaded dependency files, and all repeated dependency work
comes from the accuracy group. It cannot rule out value in larger projects with
many callers of large shared dependencies. Revisit if a representative workload
shows noticeable preparation delays attributable to repeated reads/indexing.
Extend the existing corpus and manifest for such a workload and save a separate
experiment rather than claiming these results cover it.

This is a development profiling checkpoint. Release readiness still requires a
matched comparison against the latest official release as specified in AGENTS.md.

## Reproduce

```powershell
npm run compile
npm run build
node .github/scripts/check-mcp.mjs
node bench/batch-parsing-checkpoint.mjs --output=results-batch-parsing-repeat.json
```

The runner refuses to overwrite results. The retained final file includes read,
parse and indexing timers and is the source for this report. The earlier
parse-only instrumentation run is superseded.
