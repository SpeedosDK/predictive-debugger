# Project dependency map: third measurement checkpoint

The first three planned improvements are implemented. Shared parsing across
prediction batches remains unimplemented pending measurement of duplicated work.
This checkpoint measures the new local map, not prediction accuracy or a release
comparison. Release comparisons must use the latest official release as specified
in `AGENTS.md`.

## Behavior

`map_dependencies` accepts a project directory and one source file, with a depth
of one to three hops. It returns imports, reverse imports and connected tests.
Every neighbor has one shortest evidence path with original import/re-export
locations. Test markers follow the existing filename/directory conventions.
These are file relationships, not runtime callers or test execution coverage.

For example, the fixture's `entry.test.ts` imports `consumer.ts`, which imports
`entry.ts`. A depth-two query for `entry.ts` returns that test with both source
locations. The unrelated test is absent. Cycles terminate without returning the
focus as its own neighbor. Type-only edges are marked, and literal dynamic
imports are distinguishable from static imports.

The map reuses the existing module-path resolver for emitted extensions and
directory indexes. It loads aliases for each importing directory, including
nested project configs. No prediction policy or context budget changed.

The scan includes tests but excludes build/vendor/hidden directories and directory
junctions or symbolic links. Canonical paths keep out-of-root imports outside the
discovered source set. Unresolved imports from the focus are returned individually;
coverage counters also disclose unresolved references across the project.

Work is bounded by the source-file count, directory-entry/depth limits, source
byte limits and import-reference count documented in README.md. Neighbor replies
have separate count and character limits. Parse/read failures and partial scans
are disclosed. No index persists between requests, so subsequent calls see edits.

## Measurements

The real stdio MCP server scanned the existing 71-file corpus for two new
neighborhood queries, five times each. The answer key lives in
`bench/manifest.json` under `dependencyMap`; fixtures and their generator extend
the existing corpus. Expected neighbors, evidence edges, path continuity, test
markers and unresolved source lines were checked for every reply.

All ten replies matched. These are two distinct queries repeated five times,
not ten independent examples.

| Query | Depth | Median round-trip time | Estimated reply tokens |
|---|---:|---:|---:|
| `src/dependencies/entry.ts` | 2 | 90.5 ms | 473 |
| `src/dependencies/leaf.ts` | 3 | 78.3 ms | 404 |

The first query after server initialization took 160.3 ms. The other query's first
call took 86.7 ms in the already-running process. Timing includes stdio overhead;
there is no old-version map to compare against. Each query indexed all 71 files,
read 191,488 source bytes and found 25 resolved file edges across the corpus.
There were 10 unresolved references, no read/parse failures and no scan truncation.

No provider was called. The new tool still has a caller-context cost:

| Serialized MCP tool metadata and instructions | Estimated tokens |
|---|---:|
| Before the map, five tools | 1,799 |
| After the map, six tools | 2,054 |
| Increase | 255 |

These estimates use `gpt-tokenizer` on the actual tool-list/instructions JSON and
reply text. Client-specific formatting, provider tokenization and caching can
change what is charged. The metadata increase is distinct from each map reply;
neither should be added to the previous prediction-trial totals as if those
experiments made map calls.

An offline comparison against the frozen step-two core found zero changed
prediction prompts across all 37 targets. No new model predictions were needed
to establish that their internal inputs are identical. This does not establish
how an agent's overall review behavior changes when given the new map tool.

## Validation and records

The test suite passes with 241 tests, including 14 dependency-map tests. Both
build outputs and the six-tool MCP smoke test pass. Tests exercise multi-hop
relationships, source evidence, cycles, aliases, nested configs, types, dynamic
imports, exclusions, discovery/reply limits, parse/byte failures, refresh after
edits, out-of-root paths and junctions.

`results-dependency-map-final.json` contains final timings, replies, metadata,
source hashes, manifest/runner hashes and baseline/candidate server bundle hashes.
Earlier intermediate runs are superseded.

The original measurement requires the local pre-map snapshot, which is not
shipped in the repository. If available, reproduce with that server bundle at
`.tmp/context-checkpoint/step3-baseline/mcp-server.cjs`, choosing new output names:

```powershell
npm test
npm run build
node .github/scripts/check-mcp.mjs
node bench/dependency-map-checkpoint.mjs --output=results-dependency-map-repeat.json
```

The benchmark makes no provider calls and does not overwrite an existing output.
Inspect the evidence and coverage fields before treating a missing neighbor as
meaningful. Graphs with unresolved dependencies are useful but partial.

## Next measurement

The map is ready for use. Before adding shared parsing across prediction batches,
measure how often the same dependency is read/parsed and how much of batch time
that local work consumes. These map timings do not establish a need for that
separate cache. Before preparing a release, compare the complete candidate with
the latest official release using matched cases and prediction counts.

This follow-up is now recorded in [BATCH-PARSING-CHECKPOINT.md](BATCH-PARSING-CHECKPOINT.md).
Shared caching is deferred because repeated dependency indexing took less than
one millisecond in the combined 37-target batch.
