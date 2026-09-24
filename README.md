<p align="center">
  <img src="https://raw.githubusercontent.com/SpeedosDK/predictive-debugger/master/logo/predictive-debugger-logo-readable.png" alt="Predictive Debugger" width="840">
</p>

# Predictive Debugger

**Website and docs: [predictivedebugger.dev](https://predictivedebugger.dev)**

[![npm version](https://img.shields.io/npm/v/predictive-debugger)](https://www.npmjs.com/package/predictive-debugger)
[![CI](https://github.com/SpeedosDK/predictive-debugger/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/SpeedosDK/predictive-debugger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/SpeedosDK/predictive-debugger)](https://github.com/SpeedosDK/predictive-debugger/stargazers)

MCP server for finding likely runtime failures in JavaScript and TypeScript.
Six tools help your coding agent rank risky files, trace dependencies, inspect
logs and get an independent model review with a line number and reason.

Uses the Claude Code, Codex or GitHub Copilot CLI you already have installed.
Prediction calls use that CLI's model access and usage allowance. No separate
API key is needed.

<a id="using-it-from-an-agent-mcp"></a>
<a id="download-and-install"></a>

## Setup

Requires [Node.js](https://nodejs.org) 22 or later. For model predictions, install
and sign in to at least one supported CLI. Python 3 is optional for log analysis.

### 1. Add the MCP server

Choose your agent below. `npx` downloads and runs the package automatically.

<details open>
<summary><strong>Claude Code</strong></summary>

Run in your project on macOS, Linux or WSL:

```bash
claude mcp add --scope project predictive-debugger -- npx -y predictive-debugger@latest
```

On native Windows, from PowerShell:

```powershell
claude mcp add --scope project predictive-debugger -- cmd /d /c npx -y predictive-debugger@latest
```

Use `--scope user` to make it available in every project.

</details>

<details>
<summary><strong>Codex</strong></summary>

For a user-level setup on macOS, Linux or WSL:

```bash
codex mcp add predictive-debugger -- npx -y predictive-debugger@latest
```

On native Windows, from PowerShell:

```powershell
codex mcp add predictive-debugger -- cmd /d /c npx -y predictive-debugger@latest
```

For project-only setup or a longer startup timeout, see
[Codex configuration](docs/setup.md#codex-project-configuration).

</details>

<details>
<summary><strong>GitHub Copilot CLI</strong></summary>

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "predictive-debugger": {
      "command": "npx",
      "args": ["-y", "predictive-debugger@latest"],
      "tools": ["*"]
    }
  }
}
```

On native Windows, use `"command": "cmd"` and
`"args": ["/d", "/c", "npx", "-y", "predictive-debugger@latest"]`.

For every project, see [Copilot user-level setup](docs/setup.md#copilot-user-level-setup).

</details>

### 2. Check the connection

Restart your agent and check `/mcp` for `predictive-debugger` and its six tools.
To check that the package downloads and print its version:

```bash
npx -y predictive-debugger@latest --version
```

Running without `--version` starts a stdio server that waits for your agent's
messages. See [setup help](docs/setup.md) for local builds and troubleshooting.

### 3. Ask your agent about the code

```text
Use Predictive Debugger to find the riskiest files in src/.
Show the imports and tests connected to src/services/orders.ts.
Check src/services/orders.ts for likely runtime failures.
Find unusual entries in logs/app.log.
```

## Tools

| Tool | What it does | Model call |
| --- | --- | --- |
| `scan_project` | Rank source files by risk density. Excludes tests by default. | No |
| `analyze_file` | Return complexity metrics, risk scores and contributing signals. | No |
| `map_dependencies` | Find imports, reverse imports and connected test files, with source-line evidence. | No |
| `analyze_logs` | Return log anomalies, ranked by severity and unusual wording. | No |
| `predict_failures` | Get an independent model verdict with a line number, reason and confidence. Supports batches. | Yes |
| `list_providers` | Check which supported CLIs are installed and their sign-in status. | No |

Start with `scan_project`, then read the files it highlights. Use
`map_dependencies` to find related files and `predict_failures` when you want a
second opinion. Pass several paths as `files` to review them concurrently.

See the [tool reference](docs/tools.md) for parameters, result fields and limits.

<details>
<summary><strong>How the server asks agents to verify new code</strong></summary>

The server's MCP instructions ask agents to check code they wrote in the current
session from a fresh context. The routing depends on file count:

| Change | Requested check |
| --- | --- |
| One file, including a feature contained in one file | A fresh `predict_failures` call |
| Several files | A sub-agent scoped to the changed files and intended behavior, where the host supports it |
| Mechanical correction with one clear answer | Neither check required |

Per-file predictions cannot verify that several files agree or that a feature
meets its requirements. The benefit of the sub-agent rule has not been measured.

</details>

<a id="security-model"></a>

## Privacy and limits

- Static analysis, dependency maps and log analysis run locally. `predict_failures`
  sends source and bounded dependency context to your CLI's model provider.
  Set `calleeContext: false` to omit dependency context.
- Credentials stay with the CLI. MCP tools can read paths the server process can
  access; project-scoped setup does not restrict file access. See the
  [security model](SECURITY.md#security-model).
- JavaScript and TypeScript are supported, including JSX, TSX and decorators.
  Vue and Svelte single-file components are not supported. Files above 4 MB are
  rejected; large predictions may cover only selected declarations.
- Risk scores and predictions can be wrong. The [benchmarks](bench/RESULTS.md)
  use development cases and do not establish accuracy on arbitrary repositories.
- Manually verified on Windows. CI covers Windows, macOS and Linux on Node 22
  and 24; real CLI installations on macOS and Linux have not been manually verified.

<a id="using-it-in-vs-code"></a>

## VS Code preview

An unfinished extension can show findings in the Problems panel. It requires a
local build and is not available on the Marketplace or as a prebuilt VSIX.
See [trying the extension](docs/vscode.md).

## Documentation

- [predictivedebugger.dev](https://predictivedebugger.dev): website, quickstart and guides.
- [Advanced setup](docs/setup.md): provider login, project scope, updates and local builds.
- [Tool reference](docs/tools.md): parameters, prediction results, dependency context and scoring.
- [VS Code preview](docs/vscode.md): development host, commands and settings.
- [Benchmarks](bench/RESULTS.md) and [method](bench/METHOD.md).
- [Development and contributing](CONTRIBUTING.md). Bug reports are welcome; code contributions are not open yet.
- [Security policy](SECURITY.md). Report vulnerabilities privately.

## License

[MIT](LICENSE).
