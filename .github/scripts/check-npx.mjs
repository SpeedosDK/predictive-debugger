import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runProcess } from "../../out/providers/processRunner.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check with npm run test:package after npm run compile.");
const npxCli = path.join(path.dirname(npmCli), "npx-cli.js");
const tempRoot = path.resolve(tmpdir());
const workspace = await mkdtemp(path.join(tempRoot, "predictive debugger npx-"));

async function run(args, options = {}) {
    const result = await runProcess({ file: process.execPath, args, cwd: root, ...options });
    assert.equal(result.code, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
}

try {
    // A publish dry run passes this setting to lifecycle scripts. The check
    // still needs a real local tarball and cache install; it never publishes.
    const packageEnv = { ...process.env, npm_config_dry_run: "false" };
    const packed = JSON.parse(await run([
        npmCli, "pack", "--json", "--pack-destination", workspace
    ], { env: packageEnv }))[0];
    const compilerAssets = (await readdir(path.join(root, "dist/typescript-lib"))).map(file => `dist/typescript-lib/${file}`);
    assert.ok(compilerAssets.includes("dist/typescript-lib/lib.es2022.full.d.ts"));
    assert.deepEqual(packed.files.map(file => file.path).sort(), [
        "CHANGELOG.md", "LICENSE", "README.md", "dist/mcp-server.js",
        "package.json", "tools/log-analyzer/analyze_logs.py", ...compilerAssets
    ].sort());
    assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, "Runtime dependencies must be bundled.");
    const tarball = path.join(workspace, packed.filename);
    const consumer = path.join(workspace, "consumer project");
    await mkdir(consumer);
    // An empty cache outside the repo prevents local dependencies or a prior
    // install from hiding missing files. Offline mode also catches unbundled deps.
    const env = {
        ...packageEnv,
        npm_config_cache: path.join(workspace, "npm cache"),
        npm_config_offline: "true",
        npm_config_audit: "false",
        npm_config_fund: "false",
        NODE_PATH: ""
    };
    const npxArgs = [npxCli, "-y", `file:${tarball}`];
    const options = { cwd: consumer, env };
    for (const flag of ["--version", "-v"]) {
        assert.equal(await run([...npxArgs, flag], options), pkg.version);
    }
    for (const flag of ["--help", "-h"]) {
        const help = await run([...npxArgs, flag], options);
        assert.match(help, /Usage: predictive-debugger-mcp/);
        assert.match(help, /npx -y predictive-debugger@latest/);
    }
    const invalid = await runProcess({
        file: process.execPath, args: [...npxArgs, "--unknown"], ...options
    });
    assert.equal(invalid.code, 1);
    assert.equal(invalid.stdout, "");
    assert.match(invalid.stderr, /Unknown arguments/);

    const packageSpec = `file:../${packed.filename}`;
    const launch = process.platform === "win32"
        ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/c", "npx", "-y", packageSpec] }
        : { command: "npx", args: ["-y", packageSpec] };
    console.log(await run([
        path.join(root, ".github/scripts/check-mcp.mjs"), launch.command, ...launch.args
    ], options));

    const python = await runProcess({ file: "python", args: ["--version"] }).catch(() => null);
    if (python?.code === 0) {
        const client = new Client({ name: "npm-log-smoke", version: "1.0.0" });
        try {
            await client.connect(new StdioClientTransport({
                ...launch, cwd: consumer,
                env: { ...env, PYTHON_PATH: "python" }
            }));
            const result = await client.callTool({ name: "analyze_logs", arguments: {
                logFile: path.join(root, "tools/log-analyzer/logs/sample.log")
            } });
            assert.ok(!result.isError);
            const logs = JSON.parse(result.content[0].text);
            assert.equal(logs.skipped, undefined, "The installed package must find its Python helper.");
            assert.ok(logs.anomalyCount > 0);
        } finally {
            await client.close();
        }
    } else {
        console.log("Skipping packaged log analysis: Python is unavailable.");
    }
    console.log(`npx package OK: ${packed.name}@${packed.version}, ${packed.size} bytes, no runtime dependencies`);
} finally {
    assert.equal(path.dirname(workspace), tempRoot);
    assert.ok(path.basename(workspace).startsWith("predictive debugger npx-"));
    await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
