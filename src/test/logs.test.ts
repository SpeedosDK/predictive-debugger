import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { analyzeLogs, bundledScriptPath } from "../core/logs/analyzeLogs";

/**
 * The analyzer is a Python script, which may not be installed on every machine
 * or CI runner. These tests cover the graceful-degradation contract, which is
 * what the rest of the pipeline depends on; the scoring itself is asserted only
 * when an interpreter is actually available.
 */
describe("analyzeLogs — degradation", () => {
    it("reports a clean score when no log file is configured", async () => {
        const result = await analyzeLogs({});
        assert.equal(result.score, 1);
        assert.equal(result.anomalyCount, 0);
        assert.match(result.skipped ?? "", /no log file configured/);
    });

    it("reports a clean score when the log file is missing", async () => {
        const result = await analyzeLogs({ logPath: "/definitely/not/here.log" });
        assert.equal(result.score, 1);
        assert.match(result.skipped ?? "", /log file not found/);
    });

    it("reports a clean score when the analyzer script is missing", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-logs-"));
        const logPath = path.join(dir, "app.log");
        await fs.writeFile(logPath, "INFO: hello\n");

        try {
            const result = await analyzeLogs({
                logPath,
                scriptPath: path.join(dir, "missing.py")
            });
            assert.equal(result.score, 1);
            assert.match(result.skipped ?? "", /log analyzer not found/);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it("never throws — a broken interpreter still yields a signal", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-logs-"));
        const logPath = path.join(dir, "app.log");
        await fs.writeFile(logPath, "INFO: hello\n");

        try {
            const result = await analyzeLogs({
                logPath,
                pythonPath: "definitely-not-python-xyz"
            });
            assert.equal(result.score, 1);
            assert.ok(result.skipped, "expected a skip reason");
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

describe("analyzeLogs — scoring", () => {
    it("bundles the analyzer script inside the package", async () => {
        await assert.doesNotReject(fs.access(bundledScriptPath()));
    });

    it("flags error and warning lines when Python is available", async (t) => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pd-logs-"));
        const logPath = path.join(dir, "app.log");
        await fs.writeFile(
            logPath,
            [
                "INFO: Starting server",
                "INFO: Handling request",
                "INFO: Handling request",
                "ERROR: Timeout contacting upstream",
                "WARN: Retrying request"
            ].join("\n")
        );

        try {
            const result = await analyzeLogs({ logPath });

            if (result.skipped) {
                t.skip(`Python unavailable: ${result.skipped}`);
                return;
            }

            assert.ok(result.anomalyCount >= 1, "expected at least one anomaly");
            assert.ok(result.score < 1, "score should drop when anomalies exist");
            assert.match(result.anomalies[0].text, /ERROR/);
            // Anomalies come back worst-first.
            for (let i = 1; i < result.anomalies.length; i++) {
                assert.ok(result.anomalies[i - 1].score >= result.anomalies[i].score);
            }
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
