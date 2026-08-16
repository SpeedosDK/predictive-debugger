# Predictive Debugger

Finds where code is likely to fail before it does. It ships in two shapes:

- a **VS Code extension** for a human reviewing their own code
- an **MCP server** so coding agents can use it as a tool while they review code

There is no API key and no OAuth flow. Model access is borrowed from whichever
CLI you are already signed in to — Claude Code or Codex. The extension never
sees, stores, or transmits a token; it shells out to the CLI and the CLI handles
auth.

## Layout

```
src/
  core/            analysis engine — no VS Code, no MCP, no I/O beyond files
    analysis/      AST metrics (ast.ts) and the heuristic risk score (risk.ts)
    logs/          wrapper around tools/log-analyzer
    prediction/    model-backed prediction: one file, or a whole project
    sourceFiles.ts shared source-tree walker
    types.ts       shared result types
  providers/       Claude Code / Codex CLI adapters + process spawning
  extension/       VS Code integration only
  mcp/             MCP stdio server
examples/
  bug-patterns/    deliberately broken files used for testing
tools/
  log-analyzer/    dependency-free Python log anomaly scorer
```

The dependency direction is one-way: `extension/` and `mcp/` both depend on
`core/` and `providers/`, and never on each other. `core/` depends on nothing
editor-specific, which is why the same engine backs both surfaces.

## Setup

```bash
npm install
npm run compile
```

You also need at least one CLI installed and signed in:

```bash
npm i -g @anthropic-ai/claude-code   # then: claude
npm i -g @openai/codex               # then: codex login
```

## Using it in VS Code

Press <kbd>F5</kbd> to launch an Extension Development Host, then:

| Command | What it does |
| --- | --- |
| `Predictive Debugger: Connect` | Pick a CLI, verify the sign-in works |
| `Predictive Debugger: Predict Failures in Current File` | Analyse the open file |
| `Predictive Debugger: Predict Failures Across Project` | Rank the whole workspace |

Results land as diagnostics in the Problems panel and as a report in
**Output → Predictive Debugger**.

Use the *"Run Extension (bug-patterns test folder)"* launch configuration to
test the project-wide command — VS Code refuses to open a folder that is already
open in another window, so the dev host needs a different folder.

## Using it from an agent (MCP)

### Claude Code

A project-scoped `.mcp.json` is already committed, so from this directory:

```bash
claude
```

Claude Code picks up the server automatically. To register it globally instead:

```bash
claude mcp add predictive-debugger -- node /absolute/path/to/out/mcp/server.js
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.predictive-debugger]
command = "node"
args = ["/absolute/path/to/out/mcp/server.js"]
```

### Tools

The first three are **deterministic**: no model call, no credentials, results in
milliseconds. These are what a reviewing agent should reach for — the agent is
already a model, so it needs facts, not a second opinion.

| Tool | Purpose |
| --- | --- |
| `analyze_file` | Complexity metrics + risk score for one file, with the signals that drove it |
| `scan_project` | Rank every source file in a directory by risk, worst first |
| `analyze_logs` | Score log lines by severity and unusual wording, return the anomalies |
| `predict_failures` | Full pipeline including a second-opinion model verdict — spawns a CLI, 5–15s per file |
| `list_providers` | Which CLIs are installed and signed in (for diagnosing failures) |

`predict_failures` is deliberately the odd one out. When an agent calls it, one
model is asking another model to review code — worth it for an independent
second opinion, wasteful as a default. The description tells the calling agent
exactly that, so it reaches for `analyze_file` first.

A typical agent review looks like: `scan_project` to find the risky files →
read those files directly → optionally `predict_failures` on the one or two that
look worst.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `predictiveDebugger.claudeModel` | *(CLI default)* | Model alias for the Claude CLI |
| `predictiveDebugger.codexModel` | *(CLI default)* | Model for the Codex CLI |
| `predictiveDebugger.logFile` | *(none)* | Workspace-relative log file to fold into the score |
| `predictiveDebugger.pythonPath` | auto | Interpreter for the log analyzer |
| `predictiveDebugger.maxFiles` | `25` | Cap on files per project run — each costs one CLI call |

## How the score works

`combinedScore` blends three signals:

```
0.4 × static risk      AST complexity: nested loops, long functions,
                       async boundaries, unguarded mutation
0.4 × model verdict    likelihood the CLI's model assigns to a concrete
                       failure, with a pattern name and line number
0.2 × log anomalies    share of log lines flagged as unusual
```

Static risk and log analysis run locally and cost nothing. Only the model
verdict spawns a CLI.
