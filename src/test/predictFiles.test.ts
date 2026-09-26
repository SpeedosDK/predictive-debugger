import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { CliLocation, CliProvider, CompleteOptions } from "../providers/types";
import { DEFAULT_CONCURRENCY, predictFiles } from "../core/prediction/predictFiles";
import { clearVerdictCache, MAX_BATCH_FILES } from "../core/prediction/predictBug";

beforeEach(clearVerdictCache);

let dir = "";

before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "predict-files-"));
});

after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

describe("predictFiles", () => {
    it("shares one provider call across eight files for every provider", async () => {
        const files = await write(Array.from({ length: 8 }, (_, i) => `batch-${i}.js`));
        for (const id of ["claude", "codex", "copilot"] as const) {
            const provider = fakeProvider({ delayFor: () => 0 });
            const result = await predictFiles(files, base({ ...provider, id }));
            assert.equal(provider.calls, 1);
            assert.equal(result.results.length, files.length);
            assert.ok(result.results.every(r => r.ai.findings[0].pattern === "none"));
        }
    });
    it("rejects oversized sources without calling the provider and preserves other results", async () => {
        const oversized = path.join(dir, "oversized.js");
        const handle = await fs.open(oversized, "w");
        await handle.truncate(4 * 1024 * 1024 + 1);
        await handle.close();
        const [normal] = await write(["normal-size.js"]);
        const provider = fakeProvider({ delayFor: () => 1 });
        const result = await predictFiles([oversized, normal, dir], base(provider));
        assert.equal(provider.calls, 1);
        assert.equal(result.results.length, 1);
        assert.equal(result.failures.length, 2);
        assert.match(result.failures[0].reason, /4 MB prediction limit/);
    });
    it("runs the log analyzer once per batch and refreshes it for the next", async () => {
        const files = await write(["log-a.js", "log-b.js", "log-c.js"]);
        const counter = path.join(dir, "analyzer-calls.txt");
        const script = path.join(dir, "analyzer.cjs");
        const logPath = path.join(dir, "app.log");
        await fs.writeFile(logPath, "ERROR example");
        await fs.writeFile(script, `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x'); console.log(JSON.stringify({anomaly_count: 1, anomalies: [{line: 1, text: 'example', score: 1}]}));`);
        const options = { ...base(fakeProvider({ delayFor: () => 1 })),
            logs: { logPath, scriptPath: script, pythonPath: process.execPath } };
        const first = await predictFiles(files, options);
        assert.equal(first.failures.length, 0);
        assert.equal(first.results.length, 3);
        assert.ok(first.results.every(r => r.logs.anomalyCount === 1));
        assert.equal(await fs.readFile(counter, "utf8"), "x");
        await predictFiles(files, options);
        assert.equal(await fs.readFile(counter, "utf8"), "xx");
        await predictFiles([], options);
        await predictFiles(files, { ...options, signal: AbortSignal.abort() });
        assert.equal(await fs.readFile(counter, "utf8"), "xx");
    });

    it("returns results in the order the paths were given, not completion order", async () => {
        // Delay the first group so later groups finish before it.
        const files = await write(Array.from({ length: 25 }, (_, i) => `concurrent-${i}.js`));
        const provider = fakeProvider({ delayFor: (prompt) => (prompt.includes("marker-concurrent-0") ? 40 : 1) });

        const { results, failures } = await predictFiles(files, base(provider));

        assert.deepEqual(failures, []);
        assert.deepEqual(
            results.map((r) => path.basename(r.file)),
            files.map(file => path.basename(file))
        );
    });

    it("runs concurrently rather than one after another", async () => {
        const files = await write(Array.from({ length: 25 }, (_, i) => `parallel-${i}.js`));
        const provider = fakeProvider({ delayFor: () => 60 });

        const started = Date.now();
        await predictFiles(files, base(provider));
        const elapsed = Date.now() - started;

        // Serial would be ~240ms for four 60ms calls; the pool runs all four at
        // once. The bound is loose because this is a timing assertion on a
        // shared machine -- it is here to catch a reintroduced `await` in a
        // loop, which would blow well past it, not to measure the scheduler.
        assert.ok(elapsed < 180, `expected concurrent execution, took ${elapsed}ms`);
        assert.ok(provider.maxInFlight > 1, `never had two calls in flight`);
    });

    it("never exceeds the concurrency bound", async () => {
        const files = await write(Array.from({ length: 41 }, (_, i) => `bounded-${i}.js`));
        const provider = fakeProvider({ delayFor: () => 20 });

        await predictFiles(files, { ...base(provider), concurrency: 2 });

        assert.equal(provider.maxInFlight, 2);
        assert.equal(provider.calls, 6);
    });

    it("defaults to DEFAULT_CONCURRENCY", async () => {
        const files = await write(Array.from({ length: MAX_BATCH_FILES * DEFAULT_CONCURRENCY + 1 }, (_, i) => `f${i}.js`));
        const provider = fakeProvider({ delayFor: () => 20 });

        await predictFiles(files, base(provider));

        assert.equal(provider.maxInFlight, DEFAULT_CONCURRENCY);
    });

    it("keeps large singleton calls concurrent after prompt-size splitting", async () => {
        const files = await write(Array.from({ length: 8 }, (_, i) => `large-${i}.js`));
        await Promise.all(files.map(file => fs.writeFile(file, `// ${"x".repeat(118_000)}`)));
        const provider = fakeProvider({ delayFor: () => 20 });
        const result = await predictFiles(files, { ...base(provider), concurrency: 4 });
        assert.equal(provider.calls, 8);
        assert.equal(provider.maxInFlight, 4);
        assert.equal(result.results.length, 8);
    });

    it("never starts more calls than there are files", async () => {
        const files = await write(["only.js"]);
        const provider = fakeProvider({ delayFor: () => 1 });

        await predictFiles(files, base(provider));

        assert.equal(provider.maxInFlight, 1);
        assert.equal(provider.calls, 1);
    });

    it("preserves successful groups and does not retry a failed provider call", async () => {
        const files = await write(Array.from({ length: 9 }, (_, i) => `failure-${i}.js`));
        const provider = fakeProvider({
            delayFor: () => 1,
            failOn: (prompt) => prompt.includes("// marker-failure-0")
        });

        const { results, failures } = await predictFiles(files, base(provider));

        assert.deepEqual(
            results.map((r) => path.basename(r.file)),
            ["failure-8.js"]
        );
        assert.equal(failures.length, 8);
        assert.equal(provider.calls, 2);
        assert.equal(path.basename(failures[0].file), "failure-0.js");
        assert.match(failures[0].reason, /provider exploded/);
    });

    it("reports an unreadable path as a failure, not a throw", async () => {
        const files = await write(["a.js"]);
        const provider = fakeProvider({ delayFor: () => 1 });

        const { results, failures } = await predictFiles(
            [...files, path.join(dir, "does-not-exist.js")],
            base(provider)
        );

        assert.equal(results.length, 1);
        assert.equal(failures.length, 1);
        assert.equal(path.basename(failures[0].file), "does-not-exist.js");
    });

    it("returns the files that finished when the signal aborts mid-batch", async () => {
        const files = await write(Array.from({ length: 20 }, (_, i) => `cancel-${i}.js`));
        const controller = new AbortController();
        const provider = fakeProvider({
            delayFor: () => 10,
            onCall: (calls) => {
                if (calls === 2) controller.abort();
            }
        });

        const { results } = await predictFiles(files, {
            ...base(provider),
            concurrency: 1,
            signal: controller.signal
        });

        // A cancelled batch is partial, not empty: the work already paid for is
        // still returned.
        assert.ok(results.length >= 1, "expected the completed files back");
        assert.ok(results.length < files.length, "expected the batch to stop early");
    });

    it("reports progress once per file", async () => {
        const files = await write(["a.js", "b.js", "c.js"]);
        const provider = fakeProvider({ delayFor: () => 1 });
        const seen: string[] = [];

        await predictFiles(files, {
            ...base(provider),
            onProgress: (file, _index, total) => {
                assert.equal(total, 3);
                seen.push(path.basename(file));
            }
        });

        assert.deepEqual([...seen].sort(), ["a.js", "b.js", "c.js"]);
    });
});

/** One file per name, each carrying a marker so the fake can tell them apart. */
async function write(names: string[]): Promise<string[]> {
    return Promise.all(
        names.map(async (name) => {
            const file = path.join(dir, name);
            await fs.writeFile(file, `// marker-${name.replace(/\.js$/, "")}\nconst x = 1;\n`);
            return file;
        })
    );
}

function base(provider: CliProvider) {
    return { provider, location: { file: "fake" } as CliLocation, calleeContext: false };
}

/**
 * A provider that records how many calls were in flight at the peak, which is
 * the only direct evidence that the pool is bounded rather than unbounded.
 */
function fakeProvider(options: {
    delayFor: (file: string) => number;
    failOn?: (prompt: string) => boolean;
    onCall?: (calls: number) => void;
}) {
    let inFlight = 0;
    const state = { maxInFlight: 0, calls: 0 };

    return {
        get maxInFlight() {
            return state.maxInFlight;
        },
        get calls() {
            return state.calls;
        },
        id: "claude" as const,
        label: "fake",
        installHint: "",
        locate: async () => ({ file: "fake" }),
        checkAuth: () => ({ hasCredentials: true }),
        complete: async (_loc: CliLocation, opts: CompleteOptions) => {
            inFlight += 1;
            state.calls += 1;
            state.maxInFlight = Math.max(state.maxInFlight, inFlight);
            options.onCall?.(state.calls);
            try {
                await new Promise((resolve) => setTimeout(resolve, options.delayFor(opts.prompt)));
                if (options.failOn?.(opts.prompt)) {
                    throw new Error("provider exploded");
                }
                const ids = [...opts.prompt.matchAll(/^REVIEW ID: (\d+)$/gm)].map(match => Number(match[1]));
                return ids.length ? JSON.stringify({ results: ids.map(id => ({ id, pattern: "none", score: 0, reason: "fine" })) })
                    : '{"pattern":"none","score":0,"reason":"fine"}';
            } finally {
                inFlight -= 1;
            }
        }
    };
}

describe("predictFiles source restriction", () => {
    it("never sends a non-source file to the provider", async () => {
        const secret = path.join(dir, ".env");
        await fs.writeFile(secret, "AWS_SECRET=abc123\n");
        const provider = fakeProvider({ delayFor: () => 0 });
        const { results, failures } = await predictFiles([secret], base(provider));
        assert.equal(provider.calls, 0);
        assert.equal(results.length, 0);
        assert.match(failures[0].reason, /only source files are sent/);
    });
});
