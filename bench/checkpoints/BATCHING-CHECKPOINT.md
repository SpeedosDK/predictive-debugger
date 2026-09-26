# Fewer CLI calls per review

> The scripts and raw results for this checkpoint were removed from the working tree when
> `bench/` was reorganized. They remain in commit `87edf8d`: restore one with
> `git checkout 87edf8d -- bench/<file>`. Surviving result files are in `../results/`.

Recorded September 25, 2026. Development experiment, not a release comparison.

Bounded multi-file model calls are the strongest measured next step. On eight
matched cases, one call instead of eight reduced internal tokens by 84.8% in
Codex and 67.7% in Copilot. This is not yet evidence that the complete tool
workflow beats direct agent review, or that accuracy is preserved generally.

## The current problem

Rechecking the hash-bound judgments in `results-cache-v083-isolated.json` gives:

| Workflow, three trials | Exact defects | False alarms | Caller tokens | Internal tokens | Total tokens | CLI dollar estimate |
|---|---:|---:|---:|---:|---:|---:|
| Direct Claude review | 48/51 | 0/60 | 623,641 | 0 | 623,641 | $0.9405 |
| Isolated tool checkpoint | 45/51 | 0/60 | 95,641 | 566,305 | 661,946 | $1.1055 |

The tool already reduces caller token traffic by 84.7%, but uses 6.1% more
tokens overall. Caller token traffic is cumulative usage, not a measurement of
peak occupied context. Neither dollar estimates nor raw token totals establish
how a provider charges a subscription quota.

The shared pipeline invokes `provider.complete` once per file. Its existing
batch operation only runs those calls concurrently. A CLI update can improve
each call while the tool continues to pay for 37 separate sessions.

Of the 64,222 estimated task-prompt tokens per 37-file trial, 40,290 are the
repeated policy and schema before the file section. These estimates use
`gpt-tokenizer`, not each provider's tokenizer, and exclude CLI-added context.
The CLI overhead makes repeated calls more expensive still.

The saved Claude replies also name both recurring defects correctly, but score
them below the fixed 0.70 gate. This establishes a filtering problem in those
records; it does not establish that lowering the gate would be safe.

## Experiment

`provider-batching.mjs` reuses the exact saved source and imported definitions.
It shares the existing evidence policy across at most eight files and asks for
one verdict per numeric file ID. The planner caps grouped prompts at 120,000
characters. Single-file calls retain their original prompts byte for byte.
The score threshold stays at 0.70. Missing or duplicate IDs become unavailable.

Each run stages the original corpora outside this repository and checks all
83 source hashes against the saved experiment. No answer key is sent to a CLI.
Responses, command arguments, usage, source hashes, prompt hashes and response
hashes remain in separate result files. Successful experiments have no
unavailable verdicts.

The targeted set has five buggy files and three clean controls: the JavaScript
cart, reconciliation worker, paging helper, TypeORM invoice, late-member lookup,
forwarded coupon, and the fixed versions of the last two. One trial per arm.

| Provider and mode | Calls | Exact defects | Other verified defects | False alarms | Total internal tokens |
|---|---:|---:|---:|---:|---:|
| Codex, one file per call | 8 | 4/5 | 0 | 0/3 | 155,724 |
| Codex, eight files per call | 1 | 4/5 | 0 | 0/3 | 23,653 |
| Copilot, one file per call | 8 | 4/5 | 1 | 0/3 | 221,228 |
| Copilot, eight files per call | 1 | 4/5 | 0 | 0/3 | 71,428 |

Codex retained the same defect identities. Copilot lost an additional valid
finding in the worker's report method, so its unchanged exact-defect count
must not be described as unchanged accuracy.

The broader check uses all 37 cases in the existing manifests, one trial:

| Provider and mode | Calls | Exact defects | Other verified defects | False alarms | Total internal tokens |
|---|---:|---:|---:|---:|---:|
| Codex, eight files per call | 5 | 15/17 | 1 | 0/20 | 124,750 |
| Copilot, eight files per call | 5 | 15/17 | 0 | 0/20 | 246,554 |
| Copilot, eight files plus isolation flags | 5 | 15/17 | 0 | 0/20 | 264,287 |

These broader runs have no matched full-corpus single-file or direct-agent arm
for Codex or Copilot. Do not compare their internal totals with the three-trial
Claude workflow totals above. Group composition also changes model behavior:
Codex's full run selects a different worker defect than its targeted run.

Claude 2.1.282 rejected the first batch with HTTP 429 and a session-limit message.
It reported zero tokens. The interrupted record is retained, excluded from
accuracy tables, and cannot establish whether Claude benefits from batching.

## Rejected shortcut and accuracy findings

The Copilot isolation variant adds `--available-tools=` and
`--no-custom-instructions`. It used 36,504 tokens on the targeted set but 7.2%
more tokens on the full set. The small-run reduction coincided with one API
request instead of two. The first full batch consumed the same initial input,
43,609 tokens, with and without the flags. There is no demonstrated context
reduction. Do not adopt these flags on the basis of this experiment.

The JavaScript cart's answer key says `discount` is optional. Its shown source
has no type or explicit contract saying that. A fallback for `lines` does not
prove that `discount` is optional too. Codex consistently returns no defect;
Copilot varies with grouping. The TypeScript equivalent explicitly declares
the optional field and both providers detect it. Keep the historical scoring,
but audit this ambiguity before using it to tune the confidence gate. Do not
rewrite the fixture merely to make the current models pass.

Two additional findings in the worker are real and separate from the planted
stale-balance overwrite. `batching-counterexamples.test.mjs` executes the actual
corpus class and demonstrates both:

- A payment arriving after the query can be skipped by a later `Date.now()` watermark.
- `report` counts a positive-magnitude reversal as a credit while `tick` subtracts it.

Judgments count these separately, bind to source/prompt/response hashes, and
never turn a different defect into credit for the planted one.

## Implementation direction

Implement bounded batching in the shared prediction pipeline so Claude, Codex
and Copilot all reuse one policy and CLI session per group. Retain per-file
source ranges, imported definitions, explicit IDs and individual failure states.
Use both file-count and token budgets; eight files is a tested candidate, not
an established optimum. Account for any retry, and avoid automatically
re-running an entire group when only one verdict is missing.

For accuracy, evaluate evidence with an explicit trigger and observable wrong
result, together with enough caller/type context to establish the contract.
Compare this with the existing numeric confidence gate on both buggy cases and
clean controls. A model-generated explanation is still a hypothesis; the mere
presence of an evidence field must not make it actionable. Do not reduce the
threshold globally based on the two Claude misses.

Before changing the default, run at least three rotated trials of the complete
direct-agent, released-tool and candidate workflows on each CLI. Verify the
latest official release then, and reuse only compatible saved baseline sessions.
Measure caller usage, internal usage including retries, peak context where
reported, exact defect identity, additional verified defects, false alarms and
unavailable results. Include new cases whose answers did not influence the design.

This experiment adds a reusable runner and evidence checks. It does not change
shipping prediction behavior or claim superior accuracy over an agent.

## Accounting and reproduction

Codex CLI was 0.157.0, explicitly requested model `gpt-5.6-sol`, with the local
high reasoning-effort setting. Its JSON events do not confirm a resolved model
name. Copilot CLI was 1.0.82; all usage reports name `claude-sonnet-5`. Claude
requested `sonnet` but never reached a model. Subscription authentication was
retained throughout.

Codex totals are input plus output; cached input is already included in input.
Copilot totals add fresh input, cache writes, cache reads and output once.
Reasoning tokens are part of output and are not added again. All raw usage is
retained. Neither Codex nor Copilot supplied a dollar estimate in these records;
the runner records null, not zero. Copilot's premium-request and AI-credit fields
remain distinct from money. Cache conditions were not controlled, and arm order
was not randomized. These are exploratory results, not stable effect estimates.

The task prompt grows from a maximum of 2,234 estimated tokens in the targeted
single-file arm to 4,628 in its batch. The full-corpus maximum is 13,065. Batching
reduces cumulative token usage while increasing context within an individual
child call. Caller context was not measured by this internal-call experiment.

The reused prompt/source record is `results-cache-v083-isolated.json`, SHA-256
`80d8cf02d66caba7b83fd971495f87783db9a5fed5d7b2fdb798b1462f4a6487`.
It identifies the isolated working bundle
`432b563f1cd3674670e26255d372cae609e64a2499ad0c799521a2a0f88248e9`.
The experiment does not execute a new product bundle. Each result includes its
runner hash and exact CLI arguments. `batching-summary.mjs` prints full result
hashes, reconciled token categories and judgment-validated counts.

```powershell
npm run compile
npm run build
node .github/scripts/check-mcp.mjs
node --test bench/provider-batching.test.mjs bench/batching-counterexamples.test.mjs
node bench/batching-summary.mjs

# Fresh calls. Use new output names after any configuration change.
node bench/provider-batching.mjs --provider=codex --model=gpt-5.6-sol --size=8 --output=results-new-codex.json
node bench/provider-batching.mjs --provider=copilot --size=8 --output=results-new-copilot.json
node bench/provider-batching.mjs --provider=claude --model=sonnet --size=8 --trials=3 --output=results-new-claude.json
```

Use `--size=1` for the matched single-file arm and `--files=` with comma-separated
filename suffixes for a targeted run. New positive responses need fresh manual
judgments; the summary deliberately rejects missing or stale judgments.

CLI references: [Codex non-interactive JSON events](https://learn.chatgpt.com/docs/non-interactive-mode)
and [Copilot tool and custom-instruction flags](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).
Installed `copilot --help` documents the usage-output-file flag used here.
