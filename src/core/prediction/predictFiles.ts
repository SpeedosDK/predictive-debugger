import { FilePrediction } from "../types";
import { predictFile, PredictOptions } from "./predictFile";

/**
 * How many provider calls may be in flight at once when no caller says.
 *
 * Each unit of concurrency is a CLI subprocess with a model call behind it, so
 * the ceiling is set by the provider's rate limit rather than by local CPU:
 * four is high enough that a typical review batch finishes in roughly one call's
 * time, and low enough that a batch does not read as a burst. Callers that know
 * their own limits should pass `concurrency` instead of relying on this.
 */
export const DEFAULT_CONCURRENCY = 4;

export interface PredictFilesOptions extends PredictOptions {
    /** Provider calls in flight at once (default {@link DEFAULT_CONCURRENCY}). */
    concurrency?: number;
    onProgress?: (file: string, index: number, total: number) => void;
}

export interface PredictFilesResult {
    /** Successful predictions, in the order the paths were given. */
    results: FilePrediction[];
    /** Paths that threw, with the reason, in the order the paths were given. */
    failures: Array<{ file: string; reason: string }>;
}

/**
 * Predict several files at once, with a bounded number of provider calls in
 * flight.
 *
 * The serial version of this was the tool's wall-clock cost. A verdict is
 * 5-15 seconds of a subprocess waiting on a model, so a four-file review spent
 * a minute doing nothing but waiting, four times in a row; the benchmark
 * measured the tool arm at roughly three times the wall-clock of an agent that
 * simply read the same files, entirely from that. The calls are independent —
 * one file's verdict never informs another's — so the serialisation bought
 * nothing.
 *
 * Ordering is restored before returning. A pool finishes out of order by
 * nature, and a caller that passed `[a, b, c]` should not have to re-match
 * replies to requests, so each slot writes into a fixed index and the array is
 * compacted at the end. `failures` is kept separate rather than being folded in
 * as a result with an error field: one unreadable file or CLI hiccup must not
 * discard the work already done on the others, and a caller iterating results
 * should not have to test each one for whether it is really a result.
 */
export async function predictFiles(
    filePaths: string[],
    options: PredictFilesOptions
): Promise<PredictFilesResult> {
    const total = filePaths.length;
    const slots: Array<FilePrediction | { reason: string } | undefined> = new Array(total);
    const limit = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, total));

    // A shared cursor rather than fixed chunks: files differ in size and the
    // provider's latency varies per call, so handing each worker the next
    // outstanding index keeps the pool full instead of leaving workers idle
    // behind whichever chunk drew the slowest file.
    let cursor = 0;

    async function worker(): Promise<void> {
        for (;;) {
            const index = cursor++;
            if (index >= total || options.signal?.aborted) {
                return;
            }

            const file = filePaths[index];
            options.onProgress?.(file, index, total);

            try {
                slots[index] = await predictFile(file, options);
            } catch (err) {
                slots[index] = { reason: err instanceof Error ? err.message : String(err) };
            }
        }
    }

    await Promise.all(Array.from({ length: limit }, () => worker()));

    const results: FilePrediction[] = [];
    const failures: Array<{ file: string; reason: string }> = [];

    for (const [index, slot] of slots.entries()) {
        if (!slot) {
            // Only reachable when the signal aborted mid-batch. The files that
            // did finish are still returned; a cancelled batch is partial, not
            // empty.
            continue;
        }
        if ("reason" in slot) {
            failures.push({ file: filePaths[index], reason: slot.reason });
        } else {
            results.push(slot);
        }
    }

    return { results, failures };
}
