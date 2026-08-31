# Contributing

Issues and pull requests are welcome.

## Getting set up

```bash
npm install
npm run build     # type-check, then bundle to dist/
npm test
```

Node 22 or later. The test runner is Node's own — there is no test framework to
install. Python 3 is optional; without it the log-analyzer tests self-skip
rather than fail.

For the VS Code extension, press <kbd>F5</kbd> for an Extension Development
Host. For the MCP server, `npm run build` then point your agent at
`dist/mcp-server.js`; a project-scoped `.mcp.json` is already committed.

## Before opening a pull request

```bash
npm run check     # tsc --noEmit; esbuild does no type checking
npm test
```

CI runs these on Linux, macOS and Windows across Node 22 and 24, plus a
smoke test that the bundled MCP server starts and lists its tools.

## Branches and releases

- **`master`** is the released line. What is on it is what has shipped. The CI
  badge in the README tracks it.
- **`develop`** is where a version is assembled and tested. Work lands here
  first, and reaches `master` only when it is ready to be a release.

Pull requests should target `develop` unless they fix something already released.

Cutting a release means: move the `[Unreleased]` entries in
[CHANGELOG.md](CHANGELOG.md) under a dated version heading, set the version in
`package.json` to match (the MCP server reports it and `prepack` rebuilds from
it, so that one edit covers both), merge `develop` into `master`, and tag the
merge `vX.Y.Z`.

## How this codebase is organised

The dependency direction is one-way: `extension/` and `mcp/` both depend on
`core/` and `providers/`, and never on each other. `core/` depends on nothing
editor-specific. A change that makes `core/` import from `vscode` or from the
MCP SDK is the one structural thing to avoid — it is what lets the same engine
back both surfaces.

Two seams carry the design, and both have two real implementations:

- `CliProvider` (`src/providers/types.ts`) — Claude, Codex and Copilot sit behind it.
  Adding a third CLI should mean adding one adapter and touching nothing else.
- `StateStore` (`src/providers/registry.ts`) — `vscode.Memento` satisfies it
  structurally, and the MCP server uses an in-memory store.

## What gets tested

The pure logic: the risk model, AST metrics, the score blend, model-reply
parsing, Windows argument quoting, the source-tree walker, and the log
analyzer's degradation contract. Anything that needs a signed-in CLI is
deliberately not unit-tested.

If a decision rule is worth documenting, it is worth extracting so it can be
tested without a model call — `core/prediction/confidence.ts` and
`core/prediction/score.ts` are both there for that reason.

## Changing a number

Weights, thresholds and prompt wording in this project are backed by
measurements in [bench/RESULTS.md](bench/RESULTS.md), and the comments next to
them say which measurement. If you change one, re-run the benchmark and update
both the comment and the report:

```bash
npm run bench      # real CLI calls; takes minutes and consumes model usage
npm run bench:ts
```

If you cannot run the benchmark, say so in the pull request rather than
adjusting the documented figures by hand. Note that the corpora are generated
and the prompt has been revised against them, so these are in-sample numbers —
a change that only improves them has not necessarily improved anything.

## Commit and PR style

Explain why in the commit message, not just what. The existing history and the
comments in `src/core/prediction/` are the house style: state the behaviour, then
the measurement or bug that motivated it.

## Reporting a bug

Include the platform, the Node version, which provider CLI you are using, and
the file that triggered it if you can share it. For anything security-relevant,
follow [SECURITY.md](SECURITY.md) instead of opening an issue.
