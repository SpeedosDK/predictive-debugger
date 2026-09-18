# Add optional Jev scoring

Predictive Debugger works without a Typesafe account or API key. Jev adds an
experimental review of findings from your existing CLI provider. You still need
Claude Code, Codex, or Copilot to identify and explain failures.

Jev scores how strongly the shown code supports each finding and the impact of
the reported failure. It returns a suggested review order. It does not discover
additional bugs, review a Git diff, or establish correctness across files. To
review new work, pass the changed files to `predict_failures`.

## Connect through MCP

1. Create a key in your Typesafe account.
2. Supply `TYPESAFE_API_KEY` to the MCP server through your client's private
   environment or secret manager. Keep it out of project configuration and shell
   history. The server does not load `.env` files.
3. Restart the MCP server so it receives the environment variable.
4. Request scoring explicitly:

   ```json
   {
     "files": ["/project/src/service.ts", "/project/src/store.ts"],
     "multi": true,
     "jev": true
   }
   ```

Omit `jev` or pass `false` to avoid Typesafe requests, even when a key is present.
Never paste the key into a chat, tool argument, command-line argument, or tracked
MCP configuration. An environment variable is available to the server process;
it is not an encrypted credential store. Prefer your client's secret injection
mechanism where supported.

## Connect through VS Code

Run **Predictive Debugger: Connect Typesafe Jev** and enter the key in the masked
prompt. This stores it in VS Code SecretStorage and enables scoring for future
file and project predictions in trusted workspaces. The connection prompt
explains the data transfer and paid API use. Saving a key makes no API request;
the next prediction checks it.

Run **Predictive Debugger: Disconnect Typesafe Jev** to delete the stored key and
disable scoring for new predictions. A prediction already running may finish
its scoring request. The extension does not use `TYPESAFE_API_KEY` as a fallback.

## Read the result

The original `score`, `combinedScore`, `actionable`, finding order and Problems
panel behavior remain unchanged. An additional `jev` object reports:

| Status | Meaning |
| --- | --- |
| `scored` | Contains Jev's model, rubric version, ranked findings and token usage |
| `skipped` | No concrete findings, or the evidence exceeds the context limits |
| `unavailable` | Missing or invalid key, authentication failure, rate limit, timeout, cancellation, network failure, service error, or invalid response |

`jev.findings` is ordered by descending `priority`, with ties in original order.
Each `findingIndex` is zero-based and refers to the original findings array.
For a single finding, index `0` refers to the top-level MCP verdict. VS Code
prints the equivalent one-based finding number in its output channel.

`evidence.score` and `impact.score` are positions on five-level descriptive
rubrics, divided by four to fit 0–1. `priority` is their product. These values
are experimental ranking signals, not probabilities that a bug exists.
Each dimension's `confidence` describes how concentrated Jev's answer
distribution is, not whether the answer is correct. Low confidence deserves
inspection. No finding is hidden or promoted into Problems because of Jev.

The pinned model is `jev-1.13.0`; the rubric is `evidence-impact-v1`. Neither
Typesafe's moving model alias nor endpoint environment overrides are used.
Jev's ranking has been benchmarked and did not improve on the existing score:
see [measurements](../bench/RESULTS-jev.md). It is not part of a release. Jev
cannot change what is detected, so the only thing it can improve is the order
findings are presented in, and the score `predict_failures` already produces
separates correct findings from wrong ones better. See the
[research and design notes](research/typesafe-jev.md) for the source evidence.

## Data and request limits

When enabled, each file with concrete findings makes at most one paid request
to `https://api.typesafe.ai/v1/systemone`. Clean and unavailable CLI verdicts
make no request. Batch concurrency follows the prediction concurrency setting.
There are no automatic retries. A request times out after ten seconds, including
reading the response; other failures also retain the original CLI result.

The request contains bounded numbered source, imported definitions and finding
text. It omits the absolute target path, logs, and the CLI's confidence values.
Source itself can contain secrets; this integration does not scrub source code.
`calleeContext: false` also excludes imported definitions from Jev.

Jev uses up to 12,000 numbered source characters from the same file snapshot.
The entire JSON request is capped at 28,000 UTF-8 bytes, below the documented
context limits with room for protocol overhead. There are at most ten findings,
with two questions each. Responses are capped at 64,000 bytes. Scoring is skipped
if a cited source line is omitted or the complete request exceeds the cap.
Other source omissions and excerpted imported definitions are disclosed in
`jev.truncated`; missing context can still affect scores.

Typesafe says it does not train on customer requests or responses. Standard API
accounts have no confirmed zero-retention guarantee; zero retention is an
enterprise offering. Check the vendor's current terms before sending private
code. [Models](https://docs.typesafe.ai/models),
[legal information](https://docs.typesafe.ai/legal).

The key is sent only in the HTTPS authorization header to the fixed Typesafe
endpoint. Redirects are rejected. Error results contain local categories rather
than remote bodies or exception text. Child CLI and log-analysis processes have
`TYPESAFE_API_KEY` removed from their environment. These controls do not protect
against a compromised host or source files that already contain credentials.
