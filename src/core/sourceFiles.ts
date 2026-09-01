import fs from "fs/promises";
import path from "path";

const SOURCE_EXTENSIONS = new Set([
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    // TypeScript's explicit module-kind extensions. Babel parses them like any
    // other .ts, but a project that uses them was previously invisible to a scan.
    ".mts",
    ".cts"
]);

const SKIP_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    "out",
    "dist",
    "build",
    ".vscode-test",
    "coverage"
]);

/**
 * Directory names whose contents are tests by convention.
 *
 * `test` and `tests` are here despite being ordinary English words because the
 * cost of being wrong is asymmetric: a source directory misread as tests drops
 * out of one ranking and the caller can pass `includeTests`, whereas a suite
 * left in wastes the reading budget the ranking exists to protect.
 */
const TEST_DIRECTORIES = new Set(["__tests__", "__test__", "__mocks__", "test", "tests", "spec"]);

/** `foo.spec.ts`, `foo.test.tsx` — the suffix convention, in either spelling. */
const TEST_FILE_NAME = /\.(spec|test)\.[^.]+$/i;

export function isSourceFile(filePath: string): boolean {
    return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Whether a path looks like a test file.
 *
 * Takes a path **relative to the scanned root**, and that is the whole reason
 * this is not a predicate over absolute paths: a caller who keeps their work in
 * `C:\projects\test\app` would otherwise have every file in the project
 * excluded by an ancestor directory that has nothing to do with their tests.
 *
 * Mocks are why this matters at all. `DENSITY_WEIGHTS` scores `asyncCalls`, and
 * a spec file full of mocked awaits reads as async complexity without carrying
 * any of the defect risk that weight is a proxy for — four of the top 25 hits
 * on a real backend were `.spec.ts` files for exactly that reason. See #10.
 */
export function isTestFile(relativePath: string): boolean {
    const segments = relativePath.split(/[\\/]/).filter(Boolean);
    const name = segments.pop() ?? "";

    return (
        TEST_FILE_NAME.test(name) ||
        segments.some((segment) => TEST_DIRECTORIES.has(segment.toLowerCase()))
    );
}

/** Recursively collect analysable source files, skipping build and vendor dirs. */
export async function collectSourceFiles(dir: string): Promise<string[]> {
    const found: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
                continue;
            }
            found.push(...(await collectSourceFiles(full)));
        } else if (entry.isFile() && isSourceFile(entry.name)) {
            found.push(full);
        }
    }

    return found;
}
