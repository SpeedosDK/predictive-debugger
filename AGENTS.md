# AGENTS.md

Guidance for an agent working in this repository. Read this before making changes.

## Build and verify

Two build outputs serve different things, and editing `src/` without rebuilding both leaves one stale:

- `npm run compile` → `out/` (plain `tsc`). `npm test` runs against this.
- `npm run build` (typecheck + `npm run bundle`) → `dist/`. This is what actually runs: the MCP
  server (`node dist/mcp-server.js`), the VS Code extension, and every `bench/` script that spawns
  a real process (`bench/cli-workflows.mjs`).

Unit tests passing after a `src/mcp/server.ts` or `src/core/` change does not mean the live tool
reflects it. Before trusting a benchmark or a manual MCP call: `npm run build`, then
`node .github/scripts/check-mcp.mjs` — a stdio smoke test that starts the real server and checks
the tool list and `instructions`.

If you change the wording of `INSTRUCTIONS` in `src/mcp/server.ts`, three other places can go
stale in the same edit: the assertions in `.github/scripts/check-mcp.mjs`, the routing table in
`README.md`, and `CHANGELOG.md`. Check all three before considering the edit done.

## Comments

Comment the design reasoning, not the discovery story. "Why this approach and not the obvious one"
earns a comment; "the tool found this bug when we ran it on X" does not — that is provenance, and
it belongs in `CHANGELOG.md`, not beside the fix. A comment earns its place when the reasoning
isn't recoverable from the code alone: a rejected alternative, a measured number, a constraint
from outside this file (a platform quirk, a rate limit, a benchmark result). Skip a comment when
the code already says it as plainly as a comment would.

Spend this on logic that is actually non-obvious. A straightforward function earns at most a
one-line summary, and plenty of code earns nothing — density should track how surprising the code
is, not how much of it there is.

If the reasoning is already written out in full elsewhere (`CHANGELOG.md`, `bench/RESULTS.md`),
point to it in one line rather than repeating it. A decision explained in two places means the
next person who changes it has to remember to change both, and usually doesn't.

## Benchmarking

- When evaluating release readiness or preparing a new version, always compare the candidate
  against the latest official release. Verify the release at that time and pin its tag and commit;
  a previous development checkpoint or the current `master` tip is not a release baseline.
- Prefer reusing the latest official release's saved benchmark results and running only the
  candidate. Verify that the saved build matches that release and that cases/source, trial count,
  resolved models, CLI and workflow settings are compatible. Follow `bench/METHOD.md` when
  selecting saved sessions; an older experiment's baseline arm may represent an older release.
  If results are missing or incompatible, explain the mismatch before proposing a baseline rerun.
- Record each version/build hash and the reused result file/hash. Report accuracy, false alarms,
  unavailable results, token usage and CLI-estimated cost, with matching case/prediction counts
  and cache accounting. Release claims use this comparison; incremental checkpoints stay separate.
- Keep benchmark measurements in `bench/results/` and experiment write-ups in
  `bench/checkpoints/`; `bench/METHOD.md` maps the folder. Keep README focused on setup
  and tool behavior.
- After changing the prompt, grouping or a provider's arguments, run
  `npm run bench:canary -- --provider=<id>` for each provider you can. It takes about a
  minute on the held-out cases. Do not tune anything against the `holdout` cases; add
  new cases instead, and freeze their answers before the first run.
  Release notes should briefly state what improved and explain any measured token/cost increase,
  linking to the results rather than repeating the report.
- Reuse `bench/corpus` and `bench/manifest.json` for a new benchmark. A new fixture corpus makes
  a new result incomparable to every existing one in `bench/RESULTS.md`; extend the answer key
  instead of building a parallel corpus.
- `bench/RESULTS.md` is the current summary, maintained by hand from the checkpoint it links;
  update it when a new comparison replaces that one. `bench/RESULTS-v080.md` and
  `bench/RESULTS-v072-full.md` are generated (`npm run bench:report`): edit their generators,
  not the files.
- Saved results describe a specific prompt, source and model configuration. Use a separate
  output file for a different experiment, and bind adjudications to the source, prompt and
  response hashes. Historical snapshots removed from the working tree remain in Git history.

## Spawning a CLI provider on Windows

`claude`/`codex`/`copilot` install as `.cmd` shims, which Node refuses to spawn directly since the
CVE-2024-27980 fix. `src/providers/processRunner.ts` is the canonical fix: route through `cmd.exe`
manually with `quoteForCmd` and `windowsVerbatimArguments`, not `shell: true` — that hands quoting
to Node's own shell-escaping, which mishandles arguments containing spaces or quotes. Follow that
file's pattern for any new provider or spawn call rather than reaching for `shell: true`.

## Versioning and releases

Semver, but this project's own bar for a minor bump — checked against its CHANGELOG history, not
asserted here — is a genuinely new capability: a new tool parameter, a new provider, a new rule
shipping. A fix or a docs-only change is a patch, even with a "Changed" section. A release is two
commits: the feature work, then a separate `chore(release): X.Y.Z` bumping `package.json` /
`package-lock.json` and cutting `CHANGELOG.md`'s `[Unreleased]` section under a version header.

## Branches

`develop` is the working branch; `master` is default and release-only. Merge by pull request.
