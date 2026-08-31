# Security policy

## Supported versions

Only the latest release is supported. This is a pre-1.0 project; fixes land on
`master` and ship in the next version rather than being backported.

## Reporting a vulnerability

Report privately through GitHub's
[private vulnerability reporting](https://github.com/SpeedosDK/predictive-debugger/security/advisories/new)
rather than opening a public issue.

Please include the version, the platform, and the smallest input that
reproduces the problem. Expect a first response within a week. This is a
single-maintainer project with no on-call rotation, so a slow reply is not a
dismissal.

## What is in scope

The threat model is spelled out under **Security model** in the
[README](README.md#security-model). The parts most worth attacking:

- **Command construction.** Every child process is `spawn`ed with an argument
  array and no shell. Prompts and file contents travel over stdin, never argv.
  On Windows, npm's `.cmd` shims are routed through `cmd.exe` with quoting this
  project controls. Anything that reaches a shell, or that lets analysed source
  influence an argument, is a vulnerability.
- **Prompt injection through analysed source.** A file under analysis is
  untrusted data that may be written to read as instructions. The prompt marks
  it as data, Claude runs with `--tools ""`, and the model's `pattern` and
  `reason` fields are length-capped. A crafted source file that gets the
  provider CLI to read unrelated files, run a command, or make a network
  request is in scope.
- **Credential handling.** The project reads no secret values. It checks only
  that a credentials file exists and is non-empty. Any path by which a token is
  read, logged, or transmitted is in scope.
- **Path handling.** The MCP tools accept absolute paths from the calling agent
  and will read any file the process can read. That is by design and is not a
  vulnerability on its own; a path that escapes an intended restriction, or
  writes anywhere, is.
- **`predictiveDebugger.pythonPath`** is machine-scoped precisely so a
  repository cannot point the executed interpreter at its own binary. A way for
  workspace-level configuration to choose that interpreter is a vulnerability.

## What is out of scope

- **`predict_failures` sends file contents to a model provider.** That is the
  documented purpose of the tool, not a leak. The deterministic tools
  (`analyze_file`, `scan_project`, `analyze_logs`) send nothing anywhere.
- **A wrong or missed prediction.** The static score is a heuristic and the
  model verdict is a model's opinion. Both are wrong sometimes; see
  [bench/RESULTS.md](bench/RESULTS.md) for how often. File those as bugs.
- **Vulnerabilities in the Claude Code, Codex, or GitHub Copilot CLI itself.** Report those to
  their own maintainers.
