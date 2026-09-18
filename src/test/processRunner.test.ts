import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { quoteForCmd, runProcess } from "../providers/processRunner";

describe("quoteForCmd", () => {
    it("leaves simple arguments untouched", () => {
        assert.equal(quoteForCmd("--print"), "--print");
        assert.equal(quoteForCmd("json"), "json");
    });

    it("quotes the empty string so it survives as an argument", () => {
        // `claude --tools ""` relies on this to disable every tool.
        assert.equal(quoteForCmd(""), '""');
    });

    it("quotes paths containing spaces", () => {
        assert.equal(
            quoteForCmd("C:\\Program Files\\app.exe"),
            '"C:\\Program Files\\app.exe"'
        );
    });

    it("quotes cmd.exe metacharacters", () => {
        for (const arg of ["a&b", "a|b", "a>b", "a^b", "a(b)"]) {
            assert.match(quoteForCmd(arg), /^".*"$/, `${arg} was left unquoted`);
        }
    });

    it("rejects shell escape and expansion inputs", () => {
        for (const arg of ['say "hi"', '%PAYLOAD%', '!PAYLOAD!', 'a\nb', 'a\rb', 'a\0b']) {
            assert.throws(() => quoteForCmd(arg), /Unsafe argument/);
        }
    });
});

describe("runProcess", () => {
    it("withholds Typesafe keys from real children, including explicit environment overrides", async () => {
        const result = await runProcess({ file: process.execPath,
            args: ["-e", "process.stdout.write(JSON.stringify({keys:Object.keys(process.env).filter(k=>k.toUpperCase()==='TYPESAFE_API_KEY'),kept:process.env.PD_KEEP}))"],
            env: { ...process.env, TYPESAFE_API_KEY: "secret", typesafe_api_key: "also-secret", PD_KEEP: "yes" } });
        assert.equal(result.code, 0);
        assert.deepEqual(JSON.parse(result.stdout), { keys: [], kept: "yes" });
    });
    for (const mode of ["timeout", "abort"] as const) {
        it(`stops the Windows shim child on ${mode}`, { skip: process.platform !== "win32" }, async () => {
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-tree-test-"));
            const script = path.join(dir, "child.cjs");
            const shim = path.join(dir, "start.cmd");
            const pidFile = path.join(dir, "pid.txt");
            const controller = new AbortController();
            let pid: number | undefined;
            try {
                await fs.writeFile(script, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
                await fs.writeFile(shim, `@echo off\r\n"${process.execPath}" "${script}"\r\n`);
                const pending = runProcess({ file: shim, args: [], timeoutMs: 2500, signal: controller.signal });
                const rejected = assert.rejects(pending, mode === "abort" ? /Cancelled/ : /timed out/);
                for (let i = 0; i < 100; i++) {
                    const value = await fs.readFile(pidFile, "utf8").catch(() => "");
                    if (value) { pid = Number(value); break; }
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                assert.ok(pid, "CLI child started");
                if (mode === "abort") controller.abort();
                await rejected;
                assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
            } finally {
                controller.abort();
                if (pid) { try { process.kill(pid); } catch {} }
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    }
    it("blocks injection before a Windows shim starts", { skip: process.platform !== "win32" }, async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-argv-test-"));
        const shim = path.join(dir, "probe.cmd");
        const marker = path.join(dir, "started.txt");
        try {
            await fs.writeFile(shim, '@echo off\r\necho started>"%~dp0started.txt"\r\n');
            for (const model of ['model" & echo INJECTED & rem "', '%PD_PAYLOAD%']) {
                await assert.rejects(async () => runProcess({
                    file: shim,
                    args: ["--model", model],
                    env: { ...process.env, PD_PAYLOAD: 'model" & echo INJECTED & rem "' }
                }), /Unsafe argument/);
            }
            await assert.rejects(fs.stat(marker), { code: "ENOENT" });
            const result = await runProcess({ file: shim, args: ["--model", "normal-model"] });
            assert.equal(result.code, 0);
            assert.equal((await fs.readFile(marker, "utf8")).trim(), "started");
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    it("passes stdin through and captures stdout", async () => {
        const result = await runProcess({
            file: process.execPath,
            args: ["-e", "process.stdin.pipe(process.stdout)"],
            input: "hello from stdin"
        });
        assert.equal(result.code, 0);
        assert.equal(result.stdout.trim(), "hello from stdin");
    });

    it("captures stderr and a non-zero exit code separately", async () => {
        const result = await runProcess({
            file: process.execPath,
            args: ["-e", "console.error('boom'); process.exit(3)"]
        });
        assert.equal(result.code, 3);
        assert.match(result.stderr, /boom/);
    });

    it("rejects when the timeout elapses", async () => {
        await assert.rejects(
            runProcess({
                file: process.execPath,
                args: ["-e", "setTimeout(() => {}, 10000)"],
                timeoutMs: 300
            }),
            /timed out/
        );
    });

    it("rejects when the signal is aborted mid-run", async () => {
        const controller = new AbortController();
        const pending = runProcess({
            file: process.execPath,
            args: ["-e", "setTimeout(() => {}, 10000)"],
            signal: controller.signal
        });
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(pending, /Cancelled/);
    });

    it("rejects immediately when the signal is already aborted", async () => {
        await assert.rejects(
            runProcess({
                file: process.execPath,
                args: ["-e", "0"],
                signal: AbortSignal.abort()
            }),
            /Cancelled/
        );
    });

    it("rejects when the executable does not exist", async () => {
        await assert.rejects(
            runProcess({ file: "definitely-not-a-real-binary-xyz", args: [] })
        );
    });
});
