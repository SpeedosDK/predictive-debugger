import fs from "fs/promises";
import path from "path";
import { loadBabel } from "./ast";

interface PathsConfig {
    base: string;
    paths: Record<string, string[]>;
}

/** Read JSON with comments through the existing parser, without evaluating expressions. */
async function readConfig(file: string, seen = new Set<string>()): Promise<PathsConfig | undefined> {
    if (seen.has(file) || seen.size >= 8) return undefined;
    seen.add(file);
    try {
        if ((await fs.stat(file)).size > 256_000) return undefined;
        const { parse } = await loadBabel();
        const ast = parse(`const config = (${await fs.readFile(file, "utf8")});`);
        const declaration: any = ast.program.body[0];
        const value = (node: any): any => {
            if (node.type === "StringLiteral" || node.type === "NumericLiteral" || node.type === "BooleanLiteral") return node.value;
            if (node.type === "NullLiteral") return null;
            if (node.type === "ArrayExpression") return node.elements.map(value);
            if (node.type === "ObjectExpression") {
                return Object.fromEntries(node.properties.map((property: any) => {
                    if (property.type !== "ObjectProperty" || property.computed || property.key.type !== "StringLiteral") throw new Error("Not JSON");
                    return [property.key.value, value(property.value)];
                }));
            }
            throw new Error("Not JSON");
        };
        const config = value(declaration.declarations[0].init);
        const dir = path.dirname(file);
        const parent = typeof config.extends === "string" && config.extends.startsWith(".")
            ? await readConfig(path.resolve(dir, config.extends.endsWith(".json") ? config.extends : `${config.extends}.json`), seen)
            : undefined;
        const options = config.compilerOptions ?? {};
        const base = typeof options.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : parent?.base ?? dir;
        const entries = Object.entries(options.paths ?? {}).filter((entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) && entry[1].every(item => typeof item === "string"));
        return {
            base,
            // Resolve here so inherited paths retain the declaring config's directory.
            paths: options.paths === undefined ? parent?.paths ?? {} : Object.fromEntries(
                entries.map(([key, targets]) => [key, targets.map(target => path.resolve(base, target))]))
        };
    } catch {
        return undefined;
    }
}

export async function loadPathAliases(fromDir: string): Promise<(specifier: string) => string[]> {
    let dir = fromDir;
    let config: PathsConfig | undefined;
    for (;;) {
        const file = path.join(dir, "tsconfig.json");
        if (await fs.stat(file).then(s => s.isFile()).catch(() => false)) {
            config = await readConfig(file);
            break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return (specifier) => {
        if (!config) return [];
        const keys = Object.keys(config.paths).filter(key => {
            const star = key.indexOf("*");
            return star < 0 ? key === specifier :
                specifier.startsWith(key.slice(0, star)) && specifier.endsWith(key.slice(star + 1)) &&
                specifier.length >= key.length - 1;
        }).sort((a, b) => {
            if (!a.includes("*")) return -1;
            if (!b.includes("*")) return 1;
            return b.indexOf("*") - a.indexOf("*");
        });
        const key = keys[0];
        if (!key) return [];
        const star = key.indexOf("*");
        const matched = star < 0 ? "" : specifier.slice(star, specifier.length - (key.length - star - 1));
        return config.paths[key].map(target => target.replace("*", matched));
    };
}
