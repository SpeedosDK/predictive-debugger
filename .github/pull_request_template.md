## What this changes

<!-- And why. The house style is to state the behaviour, then the bug or
     measurement that motivated it. -->

## Checks

- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] `core/` still imports nothing from `vscode` or the MCP SDK

## If this changes a weight, threshold, or the classifier prompt

- [ ] Benchmark re-run (`npm run bench`), or noted below that it was not
- [ ] The comment next to the number and `bench/RESULTS.md` both updated

<!-- Numbers in this project are in-sample: the corpora are generated and the
     prompt has been revised against them. A change that only improves them has
     not necessarily improved anything. Say what else you looked at. -->
