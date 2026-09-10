import fs from "fs/promises";
import path from "path";

/** Extensions we can parse, in the order a resolver should try them. */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * TypeScript's Node16 resolution has source files import each other by the
 * extension of the *emitted* file, so `./billing.js` on disk is `billing.ts`.
 * Without this mapping the one-hop lookup silently finds nothing in exactly the
 * codebases most likely to use it.
 */
const EMITTED_TO_SOURCE: Record<string, string[]> = {
    ".js": [".ts", ".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"]
};

/** Try the extension candidates, then the directory's index file. */
export async function resolveModule(fromDir: string, specifier: string): Promise<string | undefined> {
    if (!specifier.startsWith(".")) {
        return undefined;
    }

    const base = path.resolve(fromDir, specifier);
    const extension = path.extname(base);

    const candidates: string[] = [];
    if (extension) {
        candidates.push(base);
        const stem = base.slice(0, -extension.length);
        for (const swapped of EMITTED_TO_SOURCE[extension] ?? []) {
            candidates.push(`${stem}${swapped}`);
        }
    }
    for (const ext of RESOLVE_EXTENSIONS) {
        candidates.push(`${base}${ext}`);
    }
    for (const ext of RESOLVE_EXTENSIONS) {
        candidates.push(path.join(base, `index${ext}`));
    }

    for (const candidate of candidates) {
        if (await isFile(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

async function isFile(candidate: string): Promise<boolean> {
    return fs
        .stat(candidate)
        .then((stat) => stat.isFile())
        .catch(() => false);
}

