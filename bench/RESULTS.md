# Benchmark results

Measured September 26, 2026 on 49 JavaScript/TypeScript files: 24 bugs (planted, or found
later and kept) and 25 clean files. Each session is a complete agent run. It reviews every
file and reports one verdict per file. Tokens count the agent and every model call the tool
makes. Each row is two sessions.

| CLI | Agent reads the files | Agent + v0.8.2 | Agent + v0.9.0 |
|---|---|---|---|
| Claude Code 2.1.283 (Sonnet) | 21, 21 bugs · 0 false alarms · 279k tokens | 21, 21 · 0 · 771k | **21, 22 · 0 · 173k** |
| GitHub Copilot 1.0.82 (Sonnet) | 20, 20 · 1 · 883k | 22, 24 · 0 · 1.50M | **22, 22 · 0 · 598k** |
| Codex 0.157.1 (GPT-5.6 sol) | 22, 21 · 0 · 1.01M | cannot run | **23, 23 · 2, 0 · 308k** |

Tokens are the average per session.

- **Against an agent reading the files itself,** the tool finds as many bugs or more with
  every CLI, at 38% (Claude), 32% (Copilot) and 69% (Codex) fewer tokens. The reading agent
  also returned an incomplete or malformed answer twice with Copilot; tool sessions never did.
- **Against the released v0.8.2,** accuracy is the same with Claude at 78% fewer tokens.
  With Copilot, v0.8.2 finds two more bugs over the two sessions at 2.5 times the tokens.
  v0.8.2 cannot run in Codex, which refuses its tool calls when approvals are off.
- **Both of Codex's false alarms** were in one session: `headers.mts` and `receipt.entity.ts`,
  the same two Codex-only findings seen in every Codex run.

On the 12 held-out files, which were written and frozen before any run, grouped review
found 7/7 bugs with Claude and Codex and 6/7 with Copilot, with no false alarms over two
runs each ([engine checkpoint](checkpoints/ENGINE-ACCURACY.md#held-out-cases)).

## Not measured yet

These shipped after the comparison above and have unit tests, but no benchmark run:

- **CommonJS `require()` support.** The model now sees `require`d definitions, and is told
  when a required name provably is not exported. On this benchmark it changes one prompt:
  `pricingService.js`, where one review then reported the unexported `roundMoney`, a real
  defect, rather than the planted one. The scorers count that as a separate verified finding.
- **Reusing verdicts for unchanged files** in a server session. This cannot change a verdict;
  a repeated three-file call went from 3.6 s to 8 ms.

Run `npm run bench:canary -- --provider=<id>` after a CLI update to check for drift in about
a minute.

## Known limits

- `reconciliationWorker.js` (a race across an `await`) and `cartTotals.js` (a missing field
  whose optionality the file only implies) are the most-missed bugs, by the tool and by
  agents reading the files. Copilot's grouped review also tends to miss `dateWindow.js`.
- The answer key informed the tool's design, except for the 12 held-out files. Treat these
  numbers as evidence about these cases, not a guarantee for every project.
- Two defects in the generated corpus were created by accident and found by agents. They
  are listed in `manifest.json` under `discovered`, and a verdict naming one is credited
  separately, never as a false alarm.

## Details

- [Full comparison, judgments and failed sessions](checkpoints/FINAL-COMPARISON.md)
- [How grouped review regained its accuracy](checkpoints/ENGINE-ACCURACY.md)
- [Method and folder layout](METHOD.md)
- History: [v0.8.0 against v0.7.1](https://github.com/SpeedosDK/predictive-debugger/blob/v0.8.0/bench/RESULTS.md), at the v0.8.0 tag
