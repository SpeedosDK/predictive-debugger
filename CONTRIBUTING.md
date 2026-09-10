# Contributing

**Code contributions are not open yet.** This is a single-maintainer project
whose interfaces are still moving — the scoring weights, the provider seam and
the MCP reply shapes have all changed inside the last few releases. Taking pull
requests against decisions that are still in flux would mean wasting other
people's work. That will change once the shape settles; it is a timing call,
not a policy about who is welcome.

**Bug reports are open and wanted.** The prediction quality is measured against
generated corpora rather than real repositories, and the author knows it — see
the caveats in [bench/RESULTS.md](bench/RESULTS.md). A report about how this
behaved on a codebase the author cannot see is the most useful thing anyone
outside can send. Open an issue, or follow [SECURITY.md](SECURITY.md) for
anything security-relevant.

The rest of this file is how the project is built and tested. It is here for
anyone building from source, and it is what the maintainer works from.

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

## Before a change lands

```bash
npm run check     # tsc --noEmit; esbuild does no type checking
npm test
npm run build
node .github/scripts/check-mcp.mjs
npm run test:package
```

CI runs these on Linux, macOS and Windows across Node 22 and 24. The package
check runs `npm pack`, installs the tarball through `npx` from an empty cache
outside the repository, and verifies its version, MCP tools and Python helper.
It runs offline after packing and requires no provider credentials.

## Branches and releases

- **`master`** is the released line. What is on it is what has shipped. The CI
  badge in the README tracks it.
- **`develop`** is where a version is assembled and tested. Work lands here
  first, and reaches `master` only when it is ready to be a release.

Work targets `develop` unless it fixes something already released.

Keep feature work and the release bump in separate commits. The
`chore(release): X.Y.Z` commit moves `[Unreleased]` in
[CHANGELOG.md](CHANGELOG.md) under a dated version heading and updates both
`package.json` and `package-lock.json`. Merge `develop` into `master` by pull
request, then tag the release `vX.Y.Z`.

### Publishing the MCP package to npm

The package name is `predictive-debugger`; its executable is
`predictive-debugger-mcp`. npm can infer that executable because it is the only
`bin` entry, so users run `npx -y predictive-debugger@latest`.

Merge the release from `develop` into `master` by pull request and wait for every
master CI job to pass. Tag that tested commit, then publish from a clean checkout
of the tag using an npm account that can publish this package:

```bash
npm ci
npm login
npm publish --dry-run
npm publish --access public
```

`prepublishOnly` runs the test suite and the isolated package check. `prepack`
builds both bundles and injects the package version into the MCP server. The
tarball contains the built MCP server and Python helper, so consumers need no
build tools or separate npm dependencies. `.npmignore` controls this tarball;
`.vscodeignore` controls the VS Code package.

After publishing, verify the registry copy from a directory outside this repo:

```bash
npx --prefer-online -y predictive-debugger@latest --version
```

Add it to an agent with the README instructions and check that its MCP tools are
available. Publish later stable versions with the same process; configurations
using `@latest` resolve the new release when the server next starts.

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
```

If the benchmark cannot be run for a change, say so in the pull request rather
than adjusting the documented figures by hand. Note that the corpora are generated
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
