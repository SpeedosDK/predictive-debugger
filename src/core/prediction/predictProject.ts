import { collectSourceFiles } from "../sourceFiles";
import { FilePrediction, ProjectPrediction } from "../types";
import { predictFile, PredictOptions } from "./predictFile";

export interface PredictProjectOptions extends PredictOptions {
    /** Stop after this many files. Each file costs one model call. */
    maxFiles?: number;
    onProgress?: (file: string, index: number, total: number) => void;
}

export async function predictProject(
    root: string,
    options: PredictProjectOptions
): Promise<ProjectPrediction> {
    const files = (await collectSourceFiles(root)).slice(0, options.maxFiles ?? 25);
    const results: FilePrediction[] = [];
    const failures: Array<{ file: string; reason: string }> = [];

    for (const [index, file] of files.entries()) {
        if (options.signal?.aborted) {
            break;
        }
        options.onProgress?.(file, index, files.length);

        try {
            results.push(await predictFile(file, options));
        } catch (err) {
            // One unreadable file or CLI hiccup must not discard the work
            // already done on the other files.
            failures.push({
                file,
                reason: err instanceof Error ? err.message : String(err)
            });
        }
    }

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
