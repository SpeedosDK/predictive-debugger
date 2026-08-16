import fs from "fs/promises";
import path from "path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

const SKIP_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    "out",
    "dist",
    "build",
    ".vscode-test",
    "coverage"
]);

export function isSourceFile(filePath: string): boolean {
    return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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
