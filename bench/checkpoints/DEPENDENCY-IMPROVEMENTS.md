# Dependency improvements and measured tradeoffs

The three upcoming dependency improvements provide more useful evidence when
reviewing code across files:

| Improvement | What it enables |
| --- | --- |
| Called-member and state selection | For oversized imported objects and static class members, includes the method being called and prioritizes its referenced fields and helpers. An unrelated earlier method no longer takes the available space first. |
| Broader import/export resolution | Follows unambiguous wildcard barrels, re-exported imported bindings and imported constructors. Predictions can inspect contracts and implementations that were previously missing from their context. |
| Project dependency map | Shows imports, reverse imports and tests connected through imports, with file-and-line paths. Agents can find related code to inspect and tests to consider running. Import connections do not establish runtime test coverage. |

The complete [workflow comparison](https://github.com/SpeedosDK/predictive-debugger/blob/v0.8.0/bench/RESULTS.md) separates the original 28 cases
from nine added dependency cases. The candidate found all 12 new planted bug
trials, compared with 3/12 for v0.7.1. Across the complete 37-case workflow it used
3% more tokens than v0.7.1 and 30% fewer than direct reading. These development
cases informed the implementation; they are not a held-out accuracy estimate.

The dependency map makes no internal model call, but its tool description and
responses occupy the calling agent's context. Its relationship checks passed;
its effect on end-to-end debugging accuracy has not been measured. The
[dependency-map checkpoint](DEPENDENCY-MAP-CHECKPOINT.md) retains its local
measurements and limits.

Shared batch parsing remains deferred after the
[profiling checkpoint](BATCH-PARSING-CHECKPOINT.md) found less than one millisecond
of repeated dependency indexing in the combined batch. This local parsing cache
would not change provider prompt caching or reduce prompt token counts.
