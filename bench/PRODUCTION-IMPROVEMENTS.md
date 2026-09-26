# Compiler checks and grouped prediction checkpoint

The implementation now provides two concrete benefits: local compiler diagnostics
without a provider call, and shared model calls for small files across Claude,
Codex and Copilot. The model review does **not** yet demonstrate consistently
better accuracy than direct review. These are development measurements, not a
release-readiness claim or held-out accuracy estimate.

## Local compiler check

`node bench/type-check.mjs` starts the bundled MCP over stdio and runs
`check_types` on the existing 37 targets. All 83 staged source files match the
existing corpus hashes. [Raw results](results-type-check.json) identify the
bundle, arguments, replies, hashes and timings.

- Two calls checked all 37 files with no provider calls.
- Replies occupied 3,200 estimated tokens; arguments occupied 1,323. These use
  `gpt-tokenizer`, not a provider billing tokenizer. The calling agent still pays
  for those tokens. Compiler execution took 708 ms in this run, excluding server startup.
- Six planted defects have direct compiler diagnostics: optional discount access
  in `cart.model.ts`, `discount.ts` and `wildcard-discount.ts`; undefined results
  in `late-member.ts` and `forwarded-coupon.ts`; and a string's nonexistent
  `toFixed` method in `constructed-reading.ts`.
- The corpus is not a complete configured application. The compiler also returned
  eight other diagnostics, including missing exports and unsupported parameter
  decorators under inferred settings, plus 16 context issues. Those are not
  counted as model detections or silently removed as benchmark noise.

The tool preserves project roots and ambient declarations when a config exists.
It reports configuration opt-outs, unsupported project references, unresolved
dependencies and read limits. Compiler errors describe the supplied types and
settings; they are not automatic runtime-bug verdicts. No model confidence is
raised because a compiler ran.

The current compiler-check bundle is
`36d19b7084128569f4abee81138703da3e238d9242a5fa99d866087359dd577e`.
The model measurements below predate adding `check_types` to the advertised tool
list. Their prediction engine is the implemented grouped engine, but their
caller context is not identical to the final seven-tool server.

## Full model workflows

Latest official release verified on September 26, 2026:
[`v0.8.2`](https://github.com/SpeedosDK/predictive-debugger/releases/tag/v0.8.2),
commit `4e9d9729215b48563109b9c4683e6fc274f710ab`, MCP bundle
`8367421c77bed7a40d53a8c69505e357262637e9975f29580d8b7cecca7cad3c`.
The grouped checkpoint bundle is
`8ceb634b6f7329ac8f214cf13e5a82504fc58a1706f0fff6e8a020d5cdac3440`.

Each row is one 37-file trial: 17 planted bugs and 20 nominal controls. Tokens
include the calling agent and all captured internal model calls. Cache reads
and writes count once. Codex cached input is a subset of input, and reasoning
output is a subset of output. Neither subset is added again.

| CLI / workflow | Planted defects | Other reproduced defects | Unsupported control findings | Unavailable | Caller tokens | Internal tokens | Total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Copilot direct | 14/17 | 0 | 0/20 | 0/37 | 791,074 | 0 | 791,074 |
| Copilot v0.8.2 | 17/17 | 0 | 0/20 | 0/37 | 72,841 | 1,030,070 | 1,102,911 |
| Copilot grouped | 13/17 | 0 | 1/20 | 0/37 | 72,352 | 212,627 | 284,979 |
| Codex direct | 16/17 | 1 | 0/20 | 0/37 | 954,855 | 0 | 954,855 |
| Codex v0.8.2 | unavailable | 0 | unavailable | 37/37 | 114,702 spent | 0 | incomplete |
| Codex grouped | 15/17 | 3 | 0/20 | 0/37 | 142,355 | 124,598 | 266,953 |
| Claude grouped | 14/17 | 0 | 0/20 | 0/37 | 50,556 | 62,151 | 112,707 |

Copilot used CLI 1.0.82 with `claude-sonnet-5`. Codex used CLI 0.157.0 with
requested model `gpt-5.6-sol` and high reasoning effort. Claude used CLI 2.1.282
with `sonnet`, resolving to `claude-sonnet-5`; caller-side auxiliary model usage
is included. Provider caches were not reset.

Copilot's grouped checkpoint used 64% fewer total tokens than direct review and
74% fewer than v0.8.2, but its accuracy regressed. It made six internal calls
instead of 37. Other runs made five. The caller chooses its MCP batches, so the
total can exceed `ceil(files / 8)`. Earlier Copilot candidates scored 14/17 with
one false alarm, 13/17 with none, and 15/17 with none. The best run is not used
as the final result. All are retained in [the generated summary](workflow-batching-summary.json).

Codex's direct run had repeated Windows execution-helper failures and recovered
through another reading path. Its 72% observed token reduction is therefore not
a clean performance comparison. The release MCP call was rejected because it
required approval in a session with approval disabled. The candidate's accurate
read-only tool annotations allowed it to run under the same policy. A separate
candidate run hit the subscription limit; it remains unavailable, without a
fabricated token total.

Codex's additional findings are separate from planted-defect credit: backfill
discarding the opening balance in direct review; a settlement applied twice in
the grouped worker result; and decimal rounding and mixed-case header lookup in
two nominal controls. The summary retains both original control flags. They are
reproduced by [counterexample tests](batching-counterexamples.test.mjs), rather
than relabeling them as planted detections. The earlier numeric-column claim
had no demonstrated runtime misuse and remains unsupported.

Claude's earlier saved direct/release sessions use a different workflow prompt
and three trials. They are not substituted into this one-trial comparison. Its
new completed grouped run is reported alone. A matching full comparison remains
necessary before claiming a Claude workflow win.

## Accounting and context limits

| Grouped checkpoint | Fresh input | Cache reads | Cache writes | Output | CLI estimate |
| --- | ---: | ---: | ---: | ---: | --- |
| Copilot | 16 | 75,734 | 188,935 | 20,294 | 7 premium units; 69,045,630,000 nano-AIU |
| Codex | 78,803 | 180,224 | not separated | 7,926 | No dollar estimate exposed |
| Claude | 1,619 | 7,436 | 89,461 | 14,191 | $0.5027992 |

Copilot's direct run used one premium unit and 45,330,770,000 nano-AIU. The
grouped run therefore reduced tokens while increasing its CLI credit estimate
by 52%, largely with more cache writes and fewer cache reads. Against v0.8.2's
143,883,780,000 nano-AIU it fell 52%. Credits are not converted to dollars.

Cumulative token counts are not peak context-window occupancy. The largest
grouped task prompt was approximately 13,181 tokens. Grouping puts more source
in an individual child context, while reducing repeated policies and CLI
sessions. The caller receives compact verdicts instead of the source read
history. No cross-provider peak-context measurement is claimed.

## Rejected second-pass experiment

`verify-batching.mjs` ran one adversarial pass over the frozen checkpoint's named
hypotheses, hiding their original scores and requesting concrete counterexamples.
It was not integrated into production. Claude recovered the invoice finding but
demoted the directory finding, leaving 14 actionable findings. Copilot retained
the optional-field false alarm, contradicted a valid finding and produced two
malformed replies. Codex kept the same 18 findings. More model calls did not
establish a reliable accuracy gain. Raw captures and usage remain in
`results-verification-{claude,copilot,codex}.json`.

## Reproduction and evidence

```powershell
npm test
npm run build
node .github/scripts/check-mcp.mjs
npm run test:package
node bench/type-check.mjs
node bench/workflow-batching-summary.mjs
```

The package test installs a real tarball offline into an empty cache outside the
repository. It checks seven advertised tools and compiler access to Promise and
DOM declarations. The package has no runtime npm dependencies; compiler assets
increase the compressed tarball to approximately 1.84 MB.

`cli-workflows.mjs` and `capture-provider.cjs` measure real CLI callers and child
providers. Use a new output filename for a new experiment. Compatible saved
Copilot direct/release runs were reused from
`results-workflow-batching-copilot.json`; each candidate records its reused-file
SHA-256. [The summary](workflow-batching-summary.json) records every result-file
hash and build hash. [Judgments](judgments-workflow-batching.json) bind positive
verdicts to source, prompt and response hashes. Failed and incomplete runs remain
visible. The original corpus and answer key are unchanged.

Remaining acceptance work: a complete repeated comparison of the seven-tool
workflow against direct review and the official release, demonstrating stable
accuracy as well as token savings. The current evidence supports the compiler
capability and batching savings, not a blanket claim that the MCP outperforms
every agent on accuracy.
