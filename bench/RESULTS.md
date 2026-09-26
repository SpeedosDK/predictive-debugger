# Benchmark results

**v0.8.0 identified 51/51 planted bug trials with 0 false alarms.**

Sonnet reviewed 37 JavaScript and TypeScript cases 3 times per workflow, every session fresh:
the 28 cases from the [previous results](results/results-v07-balanced.json) and 9 new dependency cases.
The baseline is tagged v0.7.1; v0.8.0 labels the measured candidate build.
The saved records retain its original v0.7.2 label and exact bundle hash.

![Detection and false alarms](charts/detection.svg)

| Across three trials | Agent reads files | v0.7.1 | v0.8.0 |
|---|---:|---:|---:|
| Original 28 cases: defects found | 35/39 | 38/39 | 39/39 |
| New 9 cases: defects found | 12/12 | 3/12 | 12/12 |
| Total planted bug trials found | 47/51 | 41/51 | 51/51 |
| Other verified findings | 1 | 0 | 0 |
| False alarms on clean files | 0/60 | 3/60 | 0/60 |
| Total reported tokens | 2,120,442 | 1,433,632 | 1,481,267 |

## Why v0.7.1 scores lower than before

On the original cases v0.7.1 found 38/39, the same as v0.7 in the previous results.
The test grew from 28 to 37 cases to exercise dependency resolution that the old cases barely covered.
Each new bug case needs a definition from another file. v0.7.1 leaves it out of its prompt and found
3/12; v0.8.0 includes it and found 12/12.
Direct reading can inspect those dependencies and found 12/12 new bug trials,
which explains its stronger showing against v0.7.1 on the expanded test.

v0.7.1's 3 false alarms are on clean files whose tool prompt has not changed since the previous
results, where v0.7 raised none. The model now scores them just above the reporting cut. v0.8.0
sends the same prompt; these results do not establish a precision improvement ([analysis](RESULTS-v072-full.md#the-false-alarms-come-from-the-model-not-the-build)).

![Caller and internal model usage](charts/usage.svg)

v0.8.0 used 3% more tokens than v0.7.1 and 30% fewer than direct reading.

All 9 sessions completed with a verdict for every file; no results are unavailable.
Tokens include caller and internal model usage, including cache reads and writes.

There are 17 buggy files and 20 clean controls; repeated trials are not additional bugs.
These development cases informed the tool, so this is not a held-out accuracy estimate.

[Method and reproduction](METHOD.md) | [Full analysis](RESULTS-v072-full.md) | [Raw runs](results/results-v072-full.json) |
[Defect judgments](results/judgments-v072-full.json) | [Token breakdown](results/workflow-summary.json)
