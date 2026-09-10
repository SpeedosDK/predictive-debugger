# Advanced setup

[Back to README](../README.md#setup)

The [quick setup](../README.md#setup) uses the published npm package. This page
covers provider login, registration scope, updates and source builds.

## Provider login

For predictions, install and sign in to at least one supported CLI:

```bash
npm i -g @anthropic-ai/claude-code   # then: claude
npm i -g @openai/codex               # then: codex login
npm i -g @github/copilot             # then: copilot, and /login
```

Static analysis and dependency maps need no provider login. Log analysis also
runs locally and requires Python 3. Set `PYTHON_PATH` in the MCP server's
environment if Python cannot be found automatically.

## Ask your agent to configure it

Open the project where you want to use Predictive Debugger and ask:

> Add Predictive Debugger as a project-scoped MCP server. Use `npx` with arguments
> `-y predictive-debugger@latest`. On native Windows, use `cmd` with arguments
> `/d /c npx -y predictive-debugger@latest`. Verify that it starts and lists its tools.

For every project, replace "project-scoped" with "user-level". If your agent
cannot edit its own configuration, use the [manual setup](../README.md#setup).

Scope determines where the MCP registration loads. It does not restrict which
files the server process can read. Project entries can override user-level
entries with the same name.

## Codex project configuration

Add this to `.codex/config.toml` inside a trusted project:

```toml
[mcp_servers.predictive-debugger]
command = "npx"
args = ["-y", "predictive-debugger@latest"]
startup_timeout_sec = 60
```

On native Windows, use `command = "cmd"` and
`args = ["/d", "/c", "npx", "-y", "predictive-debugger@latest"]`.

Use `~/.codex/config.toml` for every project. The startup timeout allows time for
the first package download; it can also be added to an entry created by
`codex mcp add`. Restart Codex and check `/mcp`.

See [Codex MCP configuration](https://developers.openai.com/codex/mcp/).

## Copilot user-level setup

On macOS, Linux or WSL:

```bash
copilot mcp add predictive-debugger -- npx -y predictive-debugger@latest
```

On native Windows, from PowerShell:

```powershell
copilot mcp add predictive-debugger -- cmd /d /c npx -y predictive-debugger@latest
```

Restart Copilot and check `/mcp`. See
[Copilot CLI MCP configuration](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#mcp-server-configuration).
For Claude Code, the [quick setup](../README.md#setup) supports `--scope project`
and `--scope user`; see [Claude Code's MCP docs](https://code.claude.com/docs/en/mcp).

## Updating

Configurations using `@latest` resolve the current npm release when the agent
starts the server. Restart the agent or reconnect its MCP server to use an
update. A running server keeps its current version.

To force a metadata refresh and print the downloaded version:

```bash
npx --prefer-online -y predictive-debugger@latest --version
```

Then restart your agent. For controlled updates, replace `@latest` in your
configuration with a published version such as `@0.8.0`.
See [npm's cache options](https://docs.npmjs.com/cli/v11/commands/npm-exec/#a-note-on-caching).

## Build from source

Download and extract **Source code (zip)** from the
[latest release](https://github.com/SpeedosDK/predictive-debugger/releases/latest),
or clone the repository:

```bash
git clone https://github.com/SpeedosDK/predictive-debugger.git
cd predictive-debugger
npm ci
npm run build
```

For an extracted ZIP, run the last two commands in the extracted folder.

| Output | Purpose |
| --- | --- |
| `dist/mcp-server.js` | MCP server |
| `dist/extension.js` | VS Code extension preview |

Build and test commands for contributors are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Using a local build

Configure the server command as `node` with the absolute path to
`dist/mcp-server.js` as its only argument. For example:

```bash
claude mcp add --scope project predictive-debugger -- node "/absolute/path/to/predictive-debugger/dist/mcp-server.js"
```

Keep the checkout in a permanent location, since moving it breaks that path.
The repository's `.mcp.json` already uses `node ./dist/mcp-server.js`, so Claude
Code and Copilot use the local build when started here. To switch a registration
to npm, replace its command and arguments with the `npx` setup.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| First connection times out | Run the version command once to download the package. In Codex, allow a 60-second startup timeout. |
| Windows cannot start `npx` | Use `cmd /d /c npx` as shown in the quick setup. |
| No provider is available | Ask the agent to call `list_providers`, then run the chosen CLI directly and sign in. |
| Sign-in is reported but prediction fails | Some credential-store checks are provisional. Run the CLI directly to verify live access. |
| Server appears to hang in a terminal | With no arguments, it waits for MCP messages over stdio. Use `--version` or `--help` for a terminal check. |
| An older version still runs | Restart the agent and check for a project registration overriding your user-level configuration. |
| Log analysis is unavailable | Install Python 3 or set `PYTHON_PATH` in the MCP server environment. |
