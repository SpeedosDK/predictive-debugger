import { collectSourceFiles } from "../sourceFiles";
import { ProjectPrediction } from "../types";
import { PredictOptions } from "./predictFile";
import { DEFAULT_CONCURRENCY, predictFiles } from "./predictFiles";

export interface PredictProjectOptions extends PredictOptions {
    /** Stop after this many files. Each file costs one model call. */
    maxFiles?: number;
    /** Provider calls in flight at once (default {@link DEFAULT_CONCURRENCY}). */
    concurrency?: number;
    onProgress?: (file: string, index: number, total: number) => void;
}

export async function predictProject(
    root: string,
    options: PredictProjectOptions
): Promise<ProjectPrediction> {
    const files = (await collectSourceFiles(root)).slice(0, options.maxFiles ?? 25);

    // Files are independent, so this is a pool rather than a loop. Note that
    // `onProgress` now reports starts, which no longer arrive in index order:
    // a progress UI should count them, not treat the index as a position.
    const { results, failures } = await predictFiles(files, options);

    return {
        projectRisk: average(results.map((r) => r.combinedScore)),
        files: results.sort((a, b) => b.combinedScore - a.combinedScore),
        failures
    };
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
}
