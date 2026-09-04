import { FilePrediction } from "../types";
import { predictFile, PredictOptions } from "./predictFile";

/**
 * Default provider calls in flight at once. Each unit is a CLI subprocess
 * hitting a rate limit, not local CPU -- four clears a typical batch in about
 * one call's time without reading as a burst. Callers who know their own
 * limits should pass `concurrency` instead.
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
 * flight. The calls are independent -- one file's verdict never informs
 * another's -- so the previous one-at-a-time version bought nothing but wall
 * clock: see bench/RESULTS.md for the measured cost of that.
 *
 * Ordering is restored before returning, since a pool finishes out of order
 * and a caller passing `[a, b, c]` shouldn't have to re-match replies to
 * requests. `failures` is kept separate from `results` rather than folded in
 * with an error field, so one bad file doesn't force every caller to check
 * which kind of thing it got back.
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
