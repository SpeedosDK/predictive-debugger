import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
        for (const arg of ["a&b", "a|b", "a>b", "a^b", "a%b%", "a(b)"]) {
            assert.match(quoteForCmd(arg), /^".*"$/, `${arg} was left unquoted`);
        }
    });

    it("escapes embedded double quotes", () => {
        assert.equal(quoteForCmd('say "hi"'), '"say \\"hi\\""');
    });
});

describe("runProcess", () => {
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
