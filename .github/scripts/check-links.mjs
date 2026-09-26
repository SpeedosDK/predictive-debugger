// Fails when a relative Markdown link, or a bench/ document path named in source, does not resolve.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skip = new Set(["node_modules", ".git", "out", "dist", ".tmp", "corpus", "corpus-ts", "promo"]);
const files = [];
(function walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { if (!skip.has(name)) walk(full); }
        else if (/\.(md|ts|mjs|cjs)$/.test(name)) files.push(full);
    }
})(root);

const broken = [];
for (const file of files) {
    const text = readFileSync(file, "utf8");
    const targets = file.endsWith(".md")
        ? [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)].map(m => [m[1], path.dirname(file)])
        : [...text.matchAll(/\b(bench\/[\w./-]+\.md)\b/g)].map(m => [m[1], root]);
    for (const [target, base] of targets) {
        if (/^[a-z]+:/i.test(target)) continue;
        if (!existsSync(path.resolve(base, decodeURIComponent(target)))) {
            broken.push(`${path.relative(root, file)} -> ${target}`);
        }
    }
}
if (broken.length) {
    console.error(`${broken.length} broken link(s):\n  ${broken.join("\n  ")}`);
    process.exit(1);
}
console.log(`Links OK across ${files.length} files.`);
