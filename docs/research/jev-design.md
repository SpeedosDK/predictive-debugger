# Jev integration design

## Problem and existing flow

MCP and VS Code both call the core prediction pipeline. `predictFile` reads one
source snapshot, collects imported definitions, asks a CLI for findings, then
combines the top finding with static and log scores. `predictFiles` bounds
concurrency; `predictProject` orders files by combined score. MCP serializes
findings explicitly, while VS Code applies the existing confidence threshold
before publishing diagnostics.

Jev evaluates rubric questions about supplied evidence. It does not implement
the text-generation interface used by CLI providers. The [research](typesafe-jev.md)
records the protocol and vendor constraints.

## Usage and shape

Existing callers omit `jev`. MCP callers request `jev: true`; the server supplies
the key from its environment. VS Code users explicitly connect with a masked
prompt, which stores the key in SecretStorage.

```ts
const jev = createJevReviewer({ apiKey });
const result = await predictFile(file, { provider, location, jev });
// result.ai and result.combinedScore retain their existing meanings.
// result.jev contains a separate ranking or a skipped/unavailable result.
```

`createJevReviewer` captures the credential and returns one function taking
source, imported definitions, assessment and cancellation. It owns request
construction, rubrics, context limits, HTTP, response validation, normalization,
and safe failure categories. Callers do not handle wire responses or keys during
prediction. `JevReview` distinguishes scored, skipped and unavailable states.

Each scored finding references its zero-based original index. Ranking uses
evidence times impact; original finding order and confidence remain unchanged.
The model and rubric are pinned. Probability validation allows accumulated
two-decimal rounding, at most 0.03 in the probability sum and 0.06 in the weighted
score. Those tolerances are local policy, not a vendor guarantee.

## Candidate comparison

Two independent design candidates considered core integration and a separate
`score_predictions` tool with an extension command to score retained results.
A separate reviewer scored the candidates on flow, snapshot consistency, cost
control, interface size and testability. Core integration scored 23/25; a separate
tool scored 15/25. These are design judgments, not benchmark measurements.

Core integration is the base because it reuses the source snapshot and serves
both interfaces without a second source-loading flow. The explicit opt-in from
the separate-tool design carries over as the MCP flag and deliberate extension
connection. A separate tool would need snapshot hashes and stored results to
avoid reviewing findings against changed code.

A new CLI provider was rejected because Jev cannot generate findings and
explanations. Replacing the existing scores was rejected because rubric scores
have not been calibrated against the current actionable threshold.

## Tradeoffs and verification

Scoring adds up to one paid request per eligible file and may add ten seconds
before falling back. Jev receives a smaller source selection than the CLI from
the same snapshot. Missing cited lines cause a skip; other omissions are disclosed.
This bounds cost but can reduce the evidence available for judgment.

Unit tests exercise real source selection and prediction orchestration with a
simulated remote transport. The VS Code command test substitutes the unavailable
editor host to check secret storage, masked input, cancellation and trust.
`node .github/scripts/check-jev.mjs` exercises the built server through MCP with a
fixture CLI subprocess and simulated HTTP responses. It verifies default/off
behavior, ranking, batch deduplication, safe fallback and credential isolation.
`node .github/scripts/check-mcp.mjs` checks the advertised contract.

No paid Typesafe call or quality benchmark is part of these checks. A future
evaluation must reuse the benchmark corpus and compare against the then-current
official release before making release-quality claims.
