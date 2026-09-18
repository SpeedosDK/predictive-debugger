# Is Jev better than not using Jev?

**No, on this evidence.** The score `predict_failures` already produces separates correct
findings from wrong ones better than any Jev signal, and blending Jev in makes it worse.

Jev is ranking-only — it leaves `score`, `combinedScore`, `actionable` and finding order
untouched — so it cannot change what the tool detects. Detection and false-alarm counts are
the ones in [RESULTS.md](RESULTS.md). The only thing Jev can improve is the order findings
are presented in, and "not using Jev" means the free ordering, not no ordering at all.

## The head-to-head

92 correct findings against 3 wrong ones, replayed from the saved sessions.

| Ranking signal | AUC |
|---|---:|
| **Tool score — free, this is "no Jev"** | 0.949 |
| Jev evidence | 0.605 |
| Jev impact | 0.786 |
| Jev priority (evidence x impact) | 0.837 |
| Tool score x Jev priority | 0.851 |

0.5 is no separation. The free baseline wins by 0.112.

Widening to every scored finding, including those below the actionable cut
(95 correct, 6 wrong), does not change the verdict: baseline
0.949, Jev priority 0.788.

Two details worth keeping:

- **Evidence is Jev's weakest dimension** (0.605), despite being the one that
  should catch a false alarm. Impact carries what separation there is (0.786).
- **Blending hurts.** Multiplying the tool's score by Jev's priority scores
  0.851, below the 0.949 of the score on its own. Jev is not
  adding information the tool lacks; it is diluting information the tool has.

## Why the adversarial cases could not settle it

14 controls were written to trip the detector, each matching a bug shape it knows, plus
6 real defects wearing innocuous shapes. The detector found 6/6 of the defects and was
fooled by 0/14 of the controls.

With no false alarms there is no negative class, so these cases produce no ranking
measurement at all. That is a strong result for the detector and a dead end for this
experiment. Running a weaker model to manufacture false alarms was tried and discarded:
it works, but the result is no longer comparable with anything in `RESULTS.md`.

An earlier draft of the controls was itself defective — two dereferenced values their
guards did not cover, one oversold stock to -5 under concurrency. The detector reported all
three and was right each time, and the run scored a spurious priority AUC of 0.000 purely
because the answer key was wrong. `adversarial-cases.test.mjs` now executes every case, so
the key is demonstrated rather than asserted.

## Cost

| Experiment | scored findings | tokens |
|---|---:|---:|
| Saved corpus replay | 101 | 131,467 |
| Adversarial | 6 | 4,950 |

At `typesafe/jev-1.13` list price (prompt $0.042/Mtok, completion free) this is well under
a cent. Cost is not the argument against Jev; the free baseline outranking it is.

## What this does not establish

The negative class is 3 findings. One reclassification moves these AUCs materially, so
the size of the gap is not trustworthy even though its direction is consistent across every
cut of the data. These are development cases that informed the tool, not a held-out sample.

A fair reading is "Jev did not earn its place on the evidence available", not "Jev is
useless". What would change the answer is a population with enough wrong findings to
measure, which a detector that declined all 14 purpose-built traps does not supply.

[Method](METHOD.md) | [Replay](results-jev-openrouter.json) | [Adversarial](results-adversarial.json)
