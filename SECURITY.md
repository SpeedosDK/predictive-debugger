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

## Security model

Credentials stay with the provider CLI. Predictive Debugger stores only the
selected provider id and checks whether credential files exist and are non-empty;
it does not read their secret values. Copilot's system credential store is not
read. The macOS Claude Keychain check and Copilot's credential-store check
are provisional; the extension's live connection check confirms access.

`predict_failures` sends source and bounded imported definitions and referenced
types to the CLI's model provider. Set `calleeContext: false` to omit dependency
context. Static analysis, dependency mapping and log analysis run locally.

Child processes receive explicit argument arrays, with prompts and source sent
over stdin. On Windows, npm's `.cmd` shims run through `cmd.exe` with controlled
quoting. Shim arguments containing double quotes, `%`, `!`, NUL or line breaks
are rejected, including model overrides and installation paths. Spaces are
supported. Source sent over stdin is not subject to these argument restrictions.

Analyzed source is untrusted data. Claude runs with its tools disabled and without
your skills, MCP servers or session files. Codex runs in a read-only sandbox with
its agent tools turned off: shell, patching, web, browser, computer use, plugins,
sub-agents and image generation. Copilot runs with an empty tool list, which also
excludes MCP tools from your own configuration. The prompt marks source as data,
and parsed reason and pattern fields are length-capped. Prefer the Claude provider
when analyzing untrusted code.

Each review call starts the CLI in a new, empty temporary folder (named
`predictive-debugger-review-*` in the system temp directory), which is deleted when
the call ends. The CLIs automatically load instruction files such as `CLAUDE.md` and
`AGENTS.md` from the folder they start in. Started inside your project, they would
send those files with every review, costing tokens, and the repository under review
could instruct its own reviewer. Nothing is written to your project.

MCP tools accept paths from the calling agent and can read files the process has
permission to read. Project-scoped registration does not restrict this access.
Only JavaScript/TypeScript source files are sent to the model: `predict_failures`
refuses other paths, such as a `.env` or key file, before any provider call, and
imported definitions resolve only to source files. One call accepts at most 100
files, and source files above 4 MB are rejected. The VS Code extension requires a
trusted workspace, and its Python interpreter setting is machine-scoped so a repository
cannot choose the executable.

JavaScript dependencies are bundled into the shipped server. Run `npm audit`
in a source checkout to inspect the dependencies used to build it. Auditing the
installed npm package does not inspect code inside the bundle.

## What is in scope

The parts most worth attacking:

- **Command construction.** Processes use argument arrays, with the controlled
  Windows shim handling described above. Unexpected command execution or a way
  for analyzed source to influence an argument is a vulnerability.
- **Prompt injection through analysed source.** A file under analysis is
  untrusted data that may be written to read as instructions. The prompt marks
  it as data, Claude runs with `--tools ""`, Codex's agent tools and Copilot's
  tool list are turned off, the CLI starts in an empty folder, and the model's
  `pattern` and `reason` fields are length-capped. A crafted source file that gets the
  provider CLI to read unrelated files, run a command, or make a network
  request is in scope.
- **Credential handling.** The project reads no secret values. It checks only
  that a credentials file exists and is non-empty. Any path by which a token is
  read, logged, or transmitted is in scope.
- **Path handling.** The MCP tools accept absolute paths from the calling agent
  and will read any file the process can read. That is by design and is not a
  vulnerability on its own; a path that escapes an intended restriction, such as
  a non-source file reaching the model provider, or that writes anywhere, is.
- **`predictiveDebugger.pythonPath`** is machine-scoped precisely so a
  repository cannot point the executed interpreter at its own binary. A way for
  workspace-level configuration to choose that interpreter is a vulnerability.

## What is out of scope

- **`predict_failures` sends file contents to a model provider.** That is the
  documented purpose of the tool, not a leak. The deterministic tools
  (`analyze_file`, `scan_project`, `map_dependencies`, `analyze_logs`) send nothing anywhere.
- **A wrong or missed prediction.** The static score is a heuristic and the
  model verdict is a model's opinion. Both are wrong sometimes; see
  [bench/RESULTS.md](bench/RESULTS.md) for how often. File those as bugs.
- **Vulnerabilities in the Claude Code, Codex, or GitHub Copilot CLI itself.** Report those to
  their own maintainers.
