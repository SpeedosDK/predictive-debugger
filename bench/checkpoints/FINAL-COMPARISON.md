# Agent reading vs. v0.8.2 vs. this build, all 49 cases

Recorded September 26, 2026. Full sessions through `cli-workflows.mjs`, not an engine-only
run: the caller agent's tokens and every internal model call are counted, each cache
category once. Result files are in `../results/`.

## Setup

- **Cases:** the 37 development targets plus the 12 held-out cases (`--suite=all`):
  24 planted or discovered bugs and 25 clean controls.
- **Arms:** `read`, where an agent reads the files itself and may open dependencies;
  `previous`, the released v0.8.2 MCP server (commit `4e9d9729`, bundle `8367421c…`);
  `current`, this build (bundle `329fa024…`, before the verdict cache, which cannot
  change a single session). Two trials each, with rotated arm order.
- **Caller:** `--caller=neutral`. The agent follows each tool version's own guidance and
  may read source only where that guidance asks. For v0.8.2 that means actionable
  verdicts only; this build asks it to confirm or dismiss `uncertain` ones.
- **CLIs:** Claude 2.1.283 (`sonnet`), Copilot 1.0.82 (`claude-sonnet-5`), Codex 0.157.1
  (`gpt-5.6-sol`, reasoning effort high). Codex has no `previous` arm: v0.8.2's tools lack
  the read-only annotation Codex requires with approvals off, so its MCP call is refused.
- **Scoring:** `workflow-accuracy.mjs --judgments=judgments-final.json`. A bug counts when
  the caller's final verdict cites a line in the answer key's range. Twelve verdicts the
  line rule cannot settle alone are judged by hand, bound to the reply hash: a planted
  defect on a nearby line counts as detected, and a different real defect gets separate
  credit rather than a hit or a false alarm. `judgment-candidates.mjs` lists them.

## Results

| CLI | Agent reads files | v0.8.2 | This build |
|---|---|---|---|
| Claude | 21, 21 /24 · 0 FA · 294k, 264k | 21, 21 · 0 · 771k, 771k | **21, 22 · 0 · 170k, 176k** |
| Copilot | 20, 20 · 1 FA · 681k, 1,084k | 22, 24 · 0 · 1,510k, 1,497k | **22, 22 · 0 · 659k, 538k** |
| Codex | 22, 21 · 0 FA (+3, +2 other real) · 1,260k, 753k | not runnable | **23, 23 · 2, 0 · 285k, 330k** |

FA is false alarms out of 25 clean files. Tokens are per session.

- **Against an agent reading the files:** this build finds as many bugs or more with every
  CLI. Averaged over both sessions it uses 38% fewer tokens with Claude, 32% with Copilot
  and 69% with Codex. Copilot's saving varies because its reading sessions alone ranged
  from 681k to 1,084k tokens.
- **Against v0.8.2:** the same accuracy with Claude at 78% fewer tokens. With Copilot,
  v0.8.2 finds 46/48 against 44/48 at 2.5 times the tokens (60% fewer for this build); the gap is mostly
  `dateWindow.js`, which a group reply calls clean with no uncertain score to re-check.
- **Direct reading found three real defects the answer key does not list:** the generated
  corpus imports `roundMoney` from `lib/currency.js` and `toDto` from `lib/serialise.js`,
  neither of which is exported, and the worker's backfill replaces a balance with a partial
  sum. The tool cannot see the first two, because its import resolver does not follow
  CommonJS `require()`.
- **Codex's two false alarms** (trial 1) are `receipt.entity.ts` and `headers.mts`, the same
  Codex-only findings as in the engine runs. Astra's checkpoint judged `headers.mts` real;
  this one does not, because nothing shown supplies mixed-case keys.

## Failed and resumed sessions

All kept in `failedRuns` of the `-resumed` files; `resume-workflow.mjs` made them resumable.

- Claude `previous#2` hit the subscription session limit and was rerun after it cleared.
- Copilot `read#2` twice returned a malformed final answer: 48 verdicts once, and 50 with
  `notifier.js` twice once. The third attempt completed. Tool sessions never did this.
- Codex `read#2` failed in the Windows shell helper before reading any file, and was rerun.

Files: `results-final-{claude,copilot,codex}.json` (as stopped) and
`results-final-claude-resumed.json`, `results-final-copilot-resumed2.json`,
`results-final-codex-resumed.json` (complete).
