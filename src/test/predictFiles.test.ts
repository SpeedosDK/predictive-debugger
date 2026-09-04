import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { CliLocation, CliProvider, CompleteOptions } from "../providers/types";
import { DEFAULT_CONCURRENCY, predictFiles } from "../core/prediction/predictFiles";

let dir = "";

before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "predict-files-"));
});

after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

describe("predictFiles", () => {
    it("returns results in the order the paths were given, not completion order", async () => {
        // Reversed delays, so completion order is the exact opposite of input
        // order. If the pool ever returns results as they land, this fails.
        const files = await write(["a.js", "b.js", "c.js", "d.js"]);
        const provider = fakeProvider({ delayFor: (file) => (file.includes("a.js") ? 40 : 1) });

        const { results, failures } = await predictFiles(files, base(provider));

        assert.deepEqual(failures, []);
        assert.deepEqual(
            results.map((r) => path.basename(r.file)),
            ["a.js", "b.js", "c.js", "d.js"]
        );
    });

    it("runs concurrently rather than one after another", async () => {
        const files = await write(["a.js", "b.js", "c.js", "d.js"]);
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
        const files = await write(["a.js", "b.js", "c.js", "d.js", "e.js", "f.js"]);
        const provider = fakeProvider({ delayFor: () => 20 });

        await predictFiles(files, { ...base(provider), concurrency: 2 });

        assert.equal(provider.maxInFlight, 2);
        assert.equal(provider.calls, 6);
    });

    it("defaults to DEFAULT_CONCURRENCY", async () => {
        const files = await write(Array.from({ length: 8 }, (_, i) => `f${i}.js`));
        const provider = fakeProvider({ delayFor: () => 20 });

        await predictFiles(files, base(provider));

        assert.equal(provider.maxInFlight, DEFAULT_CONCURRENCY);
    });

    it("never starts more calls than there are files", async () => {
        const files = await write(["only.js"]);
        const provider = fakeProvider({ delayFor: () => 1 });

        await predictFiles(files, base(provider));

        assert.equal(provider.maxInFlight, 1);
        assert.equal(provider.calls, 1);
    });

    it("isolates a failing file instead of discarding the batch", async () => {
        const files = await write(["a.js", "b.js", "c.js"]);
        const provider = fakeProvider({
            delayFor: () => 1,
            failOn: (prompt) => prompt.includes("// marker-b")
        });

        const { results, failures } = await predictFiles(files, base(provider));

        assert.deepEqual(
            results.map((r) => path.basename(r.file)),
            ["a.js", "c.js"]
        );
        assert.equal(failures.length, 1);
        assert.equal(path.basename(failures[0].file), "b.js");
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
        const files = await write(["a.js", "b.js", "c.js", "d.js"]);
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
                return '{"pattern":"none","score":0,"reason":"fine"}';
            } finally {
                inFlight -= 1;
            }
        }
    };
}
