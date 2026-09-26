# Claude provider cache and isolation checkpoint

Recorded September 25, 2026. Development checkpoint, not a release comparison.

## Question

Direct reading pays mostly cache-read prices. Can the tool's internal Claude calls
cost less without losing detections?

## What the v0.8.0 records showed

The internal calls in `results-v072-full.json` had 317k fresh (uncached) input tokens.
Almost all of them came from a `claude-haiku-4-5` call that `claude --print` makes
on its own for session metadata. That call receives the whole prompt uncached and
returns about 10 tokens. The Sonnet verdict call was already mostly cache reads.

The spawned CLI also runs in the user's project with the user's session. It loads
their skill listing and MCP servers into every call. In this repository that made one
file cost 9,076–15,617 prompt tokens. The same prompt in a clean folder cost 4,496.

## Variants

| Variant | Change |
|---|---|
| v0.8.2 | Released behavior |
| Isolated | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `--no-session-persistence`, `--disable-slash-commands`, `--strict-mcp-config`; prompt unchanged |
| System prompt | Isolated, plus the fixed instructions sent with `--system-prompt-file` so every file shares a cached prefix |

`--bare` was not tested because it requires `ANTHROPIC_API_KEY` and disables
subscription login. `--setting-sources ""` produced byte-identical prompts
without it, and it could drop auth or proxy settings, so it was excluded.

## Results

The model was Sonnet (`claude-sonnet-5`) for the caller and internal calls. The
comparison used 37 files, 17 buggy and 20 clean, with three trials per arm.
Claude Code was version 2.1.282. The baseline was v0.8.2, commit `4e9d9729`,
bundle `8367421c…`.

| Arm | Detected | False alarms | Total tokens | Fresh input | CLI-estimated $ |
|---|---|---|---|---|---|
| Agent reads files | 48/51 | 0/60 | 623,641 | 4,665 | $0.9405 |
| v0.8.2 | 45/51 | 1/60 | 1,431,687 | 309,649 | $1.7949 |
| System prompt | 40/51 | 0/60 | 453,281 | 5,055 | $0.7770 |
| **Isolated (shipped)** | **45/51** | **0/60** | **661,946** | **5,055** | **$1.1055** |

Tokens include caller and internal usage, fresh input, output, cache writes and
cache reads. Relative to v0.8.2, the isolated build used 54% fewer tokens and had
a 38% lower CLI estimate. The Haiku call accounted for 305,996 tokens in v0.8.2
and did not occur in the isolated build.

Both tool arms missed `reconciliationWorker.js` in all three trials. They also missed
`cartTotals.js` because their scores were 0.50–0.60, below the 0.70 gate.

## Why v0.8.2 no longer reproduces v0.8.0's 51/51

v0.8.0 found 51/51 with no false alarms on September 10. v0.8.2 has the same core
and provider code, and its 37 internal prompts and caller prompt are byte-identical
to that run. The difference is the Claude CLI version: the September run used
2.1.267 and this run used 2.1.282. The main effects were:

- **Borderline scores fell below the gate.** With identical prompts, scores for
  `cartTotals.js` fell from 0.80–0.82 to 0.4–0.6. Scores for
  `reconciliationWorker.js` fell from 0.72 to 0.5–0.6.
- **Direct reading became less expensive.** The read arm used 2.4–3.4k thinking
  tokens per session instead of 11–15k. It also produced about half as much output
  and finished 2.5 times faster. Its token count fell from 2.12M to 624k.

Direct CLI calls on `cartTotals.js`:

| Configuration | Scores |
|---|---|
| CLI 2.1.267 | 0.72–0.85 (6 runs) |
| CLI 2.1.282, direct to Anthropic | 0.4–0.6 (about 20 runs) |
| CLI 2.1.282 through a transparent local proxy (`ANTHROPIC_BASE_URL`) | 0.72–0.87 (10 runs) |

The drop occurs only when 2.1.282 connects directly. The proxied requests showed
identical model, effort, thinking mode and beta flags across CLI versions. The
direct-path drop remained when changing `--effort` (high, xhigh, max),
`MAX_THINKING_TOKENS`, a fixed `--system-prompt`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`,
or `ENABLE_TOOL_SEARCH=false`. The proxy scores stayed high when it used 1M context
with tool search or added the first-party attribution fields. The remaining
difference is in the direct first-party request and could not be observed.

The arms in this checkpoint all used CLI 2.1.282, so they are comparable with each
other. They are not comparable with `results-v072-full.json`. The 0.70 gate was
calibrated against CLI behavior that the tool does not control.

## Why the system-prompt variant was rejected

It was the least expensive arm, but it missed `late-member.ts` 3/3 times and
`invoice.entity.ts` 2/3 times. Each reply still named the correct defect, but its
score was lower: 0.60 instead of 0.72–0.80 for `late-member.ts`, and 0.62–0.70
instead of 0.78–0.80 for `invoice.entity.ts`. Those scores fell below
`MIN_ACTIONABLE_SCORE` (0.70). The same drop occurred when the instructions were
appended to Claude Code's system prompt instead of replacing it.

| File | User message | Appended system prompt |
|---|---|---|
| `late-member.ts` | 0.72, 0.72, 0.72 | 0.62, 0.72, 0.68 |
| `invoice.entity.ts` | 0.80, 0.75, 0.72 | 0.72, 0.72, 0.72 |

These scores are from three direct CLI calls per cell. Instruction placement
changes calibration, so the variant would require a newly measured gate.

## Other providers

Codex CLI 0.157.0 was checked by hand with the same prompt. It sent 19–20k input
tokens for a ~2.5k-token prompt, including 11,392 cached tokens. About 7.8k tokens
stayed uncached even on an identical repeat. Ignoring the user config saved
about 900 tokens, and `model_instructions_file` saved only cached tokens.
Neither was adopted. Codex also inherits the user's default model and reasoning
effort. Copilot CLI was not measured.

## Provenance

- Results: `results-cache-v083.json` (sha256 `e54b9d7c…`) for the read, v0.8.2
  and system-prompt arms. `results-cache-v083-isolated.json` (sha256 `80d8cf02…`)
  reuses those read and v0.8.2 sessions and adds fresh isolated sessions.
- Candidate bundles: system prompt `032ce86a…`; isolated `432b563f…`.
- Judgments: `judgments-cache-v083.json` and `judgments-cache-v083-isolated.json`
  are bound to source, prompt and response hashes and validated by
  `workflow-summary.mjs`'s `summarize()`.
- The saved v0.8.0 sessions could not be reused because they used CLI 2.1.267 and
  an older capture wrapper. The capture wrapper now also records a
  `--system-prompt-file`. Without that flag, its prompt hash is unchanged.
