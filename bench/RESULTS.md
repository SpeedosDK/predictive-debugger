# Benchmark results

Does `predict_failures` save context for a calling agent, and is its answer
trustworthy enough to act on without reading the file?

Corpus: 40 generated files with 6 planted bugs.
The per-file test covers 12 of them — 6 buggy files and
6 clean controls — with 3 trials per file using the `claude` CLI.

## At a glance

| | Result |
|---|---|
| Context used to read the files | **10,228 tokens** |
| Context used to ask the tool | **2,991 tokens** (29%) |
| Trials that named the planted line (±3) | **17 of 18** |
| False alarms on clean code, raw output | **13 of 18** |
| False alarms at score ≥ 0.65 | **0 of 18** |
| Latency per file | 4.4 s mean, 5.4 s worst |

The tool is precise when it finds the bug, but its raw output is noisy. The score
can filter out that noise; see section 3.

## 1. Context cost per file

The context cost of learning about the defect: read the file or ask the tool.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/context.dark.svg">
  <img alt="Tokens used per file: reading the file versus asking predict_failures" src="charts/context.light.svg">
</picture>

The answer costs roughly the same regardless of file size — 249 tokens on
average — because it contains one line, one pattern, one rationale, and the static
metrics. This creates a break-even point: the tool is cheaper only for files above
roughly 249 tokens, which is 8 of the 12 files here. For `lib/retry.js`,
at 87 tokens, asking costs more than reading.

| File | Type | Read the file | Ask the tool | Difference |
|---|---|---|---|---|
| `api/adminController.js` | clean | 3,145 | 249 | −2,896 |
| `services/orderService.js` | clean | 2,385 | 248 | −2,137 |
| `repositories/orderRepository.js` | clean | 1,083 | 257 | −826 |
| `services/pricingService.js` | bug | 983 | 260 | −723 |
| `services/inventoryService.js` | bug | 749 | 255 | −494 |
| `workers/reconciliationWorker.js` | bug | 714 | 252 | −462 |
| `services/auditService.js` | clean | 346 | 255 | −91 |
| `lib/paging.js` | clean | 313 | 234 | −79 |
| `models/payment.js` | clean | 229 | 242 | +13 |
| `lib/dateWindow.js` | bug | 113 | 248 | +135 |
| `lib/retry.js` | bug | 87 | 247 | +160 |
| `models/cartTotals.js` | bug | 81 | 244 | +163 |

## 2. Was the answer correct?

The savings matter only if the agent can trust the answer without reading the file
anyway. The clean files are the control group: they measure whether the tool invents
defects that are not there.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/outcomes.dark.svg">
  <img alt="Outcome by file and trial: whether the tool named the planted line" src="charts/outcomes.light.svg">
</picture>

| File | Type | Planted line | Outcome by trial |
|---|---|---|---|
| `api/adminController.js` | clean | — | ! 11, ! 11, ! 11 |
| `services/orderService.js` | clean | — | ! 15, ! 15, ! 15 |
| `repositories/orderRepository.js` | clean | — | ! 8, ! 8, ! 9 |
| `services/pricingService.js` | bug | 34 | ✓ 37, ✓ 36, ✓ 34 |
| `services/inventoryService.js` | bug | 28 | ✓ 29, ✓ 29, ✓ 29 |
| `workers/reconciliationWorker.js` | bug | 28 | ✗ —, ✓ 27, ✓ 26 |
| `services/auditService.js` | clean | — | ! 10, ! 10, ! 10 |
| `lib/paging.js` | clean | — | · —, · —, · — |
| `models/payment.js` | clean | — | · —, · —, ! 4 |
| `lib/dateWindow.js` | bug | 7 | ✓ 7, ✓ 7, ✓ 7 |
| `lib/retry.js` | bug | 7 | ✓ 10, ✓ 10, ✓ 10 |
| `models/cartTotals.js` | bug | 6 | ✓ 6, ✓ 6, ✓ 6 |

Naming a line counts as a hit when it is within ±3 lines of the planted defect.

## 3. Does the score separate real defects from generic noise?

The false alarms above are not fabricated. They are true but generic — *"`rows.map`
assumes that `db.query` always returns an array"*. The question is whether the score
can filter them out.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/scores.dark.svg">
  <img alt="Score distribution for buggy and clean files, with threshold" src="charts/scores.light.svg">
</picture>

| Threshold | Bugs found | False alarms |
|---|---|---|
| 0.2 | 17 of 18 | 13 of 18 |
| 0.3 | 17 of 18 | 12 of 18 |
| 0.4 | 16 of 18 | 7 of 18 |
| 0.5 | 15 of 18 | 5 of 18 |
| 0.6 | 15 of 18 | 4 of 18 |
| 0.65 | 15 of 18 | 0 of 18 |
| 0.7 | 15 of 18 | 0 of 18 |
| 0.8 | 9 of 18 | 0 of 18 |

At **score ≥ 0.65**, the tool finds 15 of 18 planted bugs
with 0 false alarms. The planted bugs score 0.70–0.90; the noise peaks at 0.60.

> **The threshold is fitted on the same trials used to evaluate it.** It is a hypothesis
> that must be reconfirmed on unseen code, not a constant.

## 4. A/B test with real agents

Two agents, the same four files, and the same task. One had to read the files; the
other could only call `predict_failures` and apply the threshold from section 3.
Neither was told which files contained bugs.

|  | Without the tool — reads the files | With the tool — calls predict_failures |
|---|---|---|
| Total tokens used | 23,449 | **17,395** |
| Time | 47.8 s | **38.9 s** |
| Source lines read | 580 | 0 |
| Bugs found | 2 of 3 | 2 of 3 |
| False alarms | 0 of 1 | 0 of 1 |

**The two agents reached identical conclusions for all four files**, including clearing
the control file and missing the race in `reconciliationWorker.js`. The tool-using
agent used 26% fewer tokens and 19% less time.

| File | Ground truth | Without the tool | With the tool |
|---|---|---|---|
| `services/pricingService.js` | bug, line 34 | line 36 ✓ | line 36 ✓ |
| `workers/reconciliationWorker.js` | bug, line 28 | none ✗ | none (score 0.4) ✗ |
| `models/cartTotals.js` | bug, line 6 | line 6 ✓ | line 6 ✓ |
| `services/orderService.js` | clean | none ✓ | none (score 0.6) ✓ |

The savings here are much smaller — 26% versus
71% in section 1. The difference is the agent's own
overhead: its system prompt, reasoning, and response dominate, while file content is
only part of the bill. **Section 1 measures savings on file content; section 4 measures
the savings in practice.**

Two things the tool did not provide:

- The agent that read the code noticed that `orderService.js` defines three methods
  twice. The tool did not mention this in any of its four trials on the file. This is
  a corpus artifact (see caveats), but the point stands: reading the code reveals things
  that asking for one answer does not.
- The tool-using agent reported uncertainty about `orderService.js`: its 0.6 score was
  just below the threshold, while the rationale sounded concrete. The threshold made
  the correct choice here, but narrowly.

## 5. Project level: does `scan_project` help choose a file?

This is a secondary result. At the same budget — read k files — how many of the
6 bugs are included? Random ordering is the null hypothesis.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/budget.dark.svg">
  <img alt="Bugs found at the same file budget using three orderings" src="charts/budget.light.svg">
</picture>

| Budget | Risk order | Directory order | Random (expected) |
|---|---|---|---|
| 5 files | 0 of 6 | 0 of 6 | 0.75 |
| 10 files | 0 of 6 | 1 of 6 | 1.5 |
| 15 files | 2 of 6 | 2 of 6 | 2.25 |
| 20 files | 3 of 6 | 3 of 6 | 3 |

The ranking beats neither directory order nor random order at any budget. The rank
correlation between `riskScore` and raw file size is **ρ = 0.824**:
in practice, it ranks the largest file first. This is not an implementation defect;
it is what a pure complexity heuristic can do. Half the planted bugs are in small
files, and the ranking never finds them.

## Caveats

- **Tokens do not disappear; they move.** `predict_failures` spawns another model that
  reads the entire file. The saving is in the calling agent's *context window*, not total
  consumption. The cost is 4.4 s of latency per file.
- **The corpus is generated, and its generator has a defect.** Files with more than eight
  methods receive duplicate method names because the name generator cycles.
  `orderService.js` defines three methods twice. This makes the "clean" controls less
  clean than intended. The measurements stand, but the corpus is less realistic than it appears.
- **Bugs are placed per file, not per line** — three in large files and three in small
  files. If real defects are distributed evenly per line of code, that favors a
  size-driven ranking per file, but not per token, which is what the agent pays for.
- **3 trials per file, and two runs in the A/B test.** This is enough to
  show that the answer varies, not enough for a precise estimate.
  `reconciliationWorker.js` scored 0.85 in two trials and was missed in the third.
- **Tokens are counted with cl100k BPE** (gpt-tokenizer), not Claude's tokenizer, except
  in section 4 where the figures come from the harness's own accounting. The ratios hold;
  the absolute figures in sections 1–3 are approximate.

## Run it yourself

```bash
node bench/generate-corpus.mjs   # corpus + answer key
node bench/measure.mjs           # project level
node bench/measure-file.mjs      # per file (real CLI calls; takes a few minutes)
node bench/markdown.mjs          # this file + charts
```

Generated 2026-08-18T11:30:19.138Z.
