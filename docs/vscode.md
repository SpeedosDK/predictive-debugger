# VS Code preview

[Back to README](../README.md#vs-code-preview)

The extension is unfinished. It is not published to the VS Code Marketplace
and no prebuilt VSIX is distributed.

## Try it from source

1. [Build the project](setup.md#build-from-source).
2. Open the Predictive Debugger folder in VS Code.
3. Press <kbd>F5</kbd> to launch an Extension Development Host.
4. Run `Predictive Debugger: Connect` in the new window to choose a CLI and
   verify its sign-in.
5. Run a prediction command below.

| Command | What it does |
| --- | --- |
| `Predictive Debugger: Connect` | Pick a CLI and verify live access |
| `Predictive Debugger: Predict Failures in Current File` | Analyze the open file |
| `Predictive Debugger: Predict Failures Across Project` | Analyze source files across the workspace, including tests |

Results appear in the Problems panel and **Output > Predictive Debugger**.
The extension requires a trusted workspace.

Use the **Run Extension (bug-patterns test folder)** launch configuration to
try the project-wide command. Its development host opens a separate fixture
folder, since VS Code cannot open the same folder in both windows.

## Settings

These are VS Code extension settings. For MCP predictions, pass the
[tool parameters](tools.md#predict_failures) instead.

| Setting | Default | Purpose |
| --- | --- | --- |
| `predictiveDebugger.claudeModel` | CLI default | Model alias for Claude |
| `predictiveDebugger.codexModel` | CLI default | Model for Codex |
| `predictiveDebugger.copilotModel` | CLI default | Model for Copilot; `auto` lets the CLI choose |
| `predictiveDebugger.logFile` | None | Workspace-relative log file to include in the score |
| `predictiveDebugger.pythonPath` | Auto-detect | Python interpreter for log analysis; machine-scoped |
| `predictiveDebugger.multipleFindings` | `false` | Request all demonstrable failures in a file; experimental |
| `predictiveDebugger.maxFiles` | `25` | Maximum files per project run; each requires a model call |

For watch mode, testing and packaging, see [CONTRIBUTING.md](../CONTRIBUTING.md).
