import fs from "fs/promises";
import path from "path";
import { loadBabel, PARSE_OPTIONS } from "./ast";
import { loadPathAliases } from "./modulePaths";
import { resolveModule } from "./moduleResolution";
import { isSourceFile, isTestFile, isSkippedSourceDirectory } from "../sourceFiles";

interface DependencyEdge {
    from: string;
    to: string;
    line: number;
    kind: "import" | "re-export" | "dynamic-import";
    typeOnly?: boolean;
}

interface UnresolvedDependency {
    file: string;
    line: number;
    specifier?: string;
    reason: string;
}

interface Neighbor {
    file: string;
    test?: boolean;
    via: DependencyEdge[];
}

interface ImportRequest {
    specifier?: string;
    line: number;
    kind: DependencyEdge["kind"];
    typeOnly?: boolean;
    unsupported?: string;
}

function importRequest(nodePath: any): ImportRequest | undefined {
    const node = nodePath.node;
    const line = node.loc?.start.line;
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" ||
        node.type === "ExportNamedDeclaration" && node.source) {
        const typeOnly = node.importKind === "type" || node.exportKind === "type" ||
            node.specifiers?.length > 0 && node.specifiers.every((specifier: any) =>
                specifier.importKind === "type" || specifier.exportKind === "type");
        return { specifier: node.source.value, line,
            kind: node.type === "ImportDeclaration" ? "import" : "re-export",
            ...(typeOnly ? { typeOnly: true } : {}) };
    }
    if (node.type === "TSImportType" || node.type === "ImportExpression") {
        const typeOnly = node.type === "TSImportType";
        return { specifier: node.source.type === "StringLiteral" ? node.source.value : undefined,
            line, kind: typeOnly ? "import" : "dynamic-import", ...(typeOnly ? { typeOnly: true } : {}) };
    }
    if (node.type === "TSImportEqualsDeclaration" && node.moduleReference.type === "TSExternalModuleReference") {
        return { line, kind: "import", unsupported: "CommonJS import assignment is not mapped" };
    }
    if (node.type === "CallExpression" && node.callee.type === "Identifier" &&
        node.callee.name === "require" && !nodePath.scope.getBinding("require")) {
        return { line, kind: "import", unsupported: "CommonJS require is not mapped" };
    }
    return undefined;
}

function findNeighbors(edges: DependencyEdge[], file: string, depth: number, reverse: boolean): Neighbor[] {
    const adjacency = new Map<string, DependencyEdge[]>();
    for (const edge of edges) {
        const key = reverse ? edge.to : edge.from;
        const list = adjacency.get(key) ?? [];
        list.push(edge);
        adjacency.set(key, list);
    }
    const seen = new Set([file]);
    const queue: Neighbor[] = [{ file, via: [] }];
    for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        if (current.via.length >= depth) continue;
        for (const edge of adjacency.get(current.file) ?? []) {
            const next = reverse ? edge.from : edge.to;
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push({ file: next, ...(isTestFile(next) ? { test: true } : {}),
                via: reverse ? [edge, ...current.via] : [...current.via, edge] });
        }
    }
    return queue.slice(1);
}

export interface DependencyMapOptions {
    directory: string;
    file: string;
    depth?: number;
    limit?: number;
    maxFiles?: number;
}

const MAX_ENTRIES = 20_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_EDGES = 10_000;
const MAX_REPLY_CHARS = 32_000;

function within(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function integer(value: number | undefined, fallback: number, maximum: number): number {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < 1 || result > maximum) throw Error(`Expected an integer from 1 to ${maximum}.`);
    return result;
}

/** Stream reads so a growing file cannot exceed the per-file or project budget. */
async function readBounded(file: string, limit: number, onRead: (bytes: number) => void): Promise<Buffer> {
    const handle = await fs.open(file, "r");
    try {
        if ((await handle.stat()).size > limit) throw Error("source byte limit");
        const chunks: Buffer[] = [];
        let size = 0;
        for (;;) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - size));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            onRead(bytesRead);
            size += bytesRead;
            if (size > limit) throw Error("source byte limit");
            chunks.push(buffer.subarray(0, bytesRead));
        }
        return Buffer.concat(chunks, size);
    } finally {
        await handle.close();
    }
}

/** Bounded file relationships, rebuilt per request; no provider or prediction dependency. */
export async function mapDependencies(options: DependencyMapOptions) {
    const root = await fs.realpath(path.resolve(options.directory));
    const focus = await fs.realpath(path.resolve(root, options.file));
    const depth = integer(options.depth, 1, 3);
    const limit = integer(options.limit, 50, 200);
    const maxFiles = integer(options.maxFiles, 1000, 2000);
    if (!(await fs.stat(root)).isDirectory()) throw Error("directory must be a directory");
    if (!within(root, focus) || !isSourceFile(focus)) throw Error("file must be a JavaScript/TypeScript source inside directory");
    const relative = (file: string) => path.relative(root, file).replace(/\\/g, "/");
    const issues: Array<{ file: string; reason: string }> = [];
    let issueCount = 0;
    const issue = (file: string, reason: string) => {
        issueCount++;
        if (issues.length < 20) issues.push({ file: relative(file), reason });
    };
    const files: string[] = [];
    let visitedEntries = 0;
    let scanLimited = false;
    const walk = async (directory: string, level: number): Promise<void> => {
        if (level > 64) {
            scanLimited = true;
            issue(directory, "directory depth limit");
            return;
        }
        try {
            const entries = [];
            const dir = await fs.opendir(directory);
            for await (const entry of dir) {
                if (visitedEntries >= MAX_ENTRIES) { scanLimited = true; break; }
                visitedEntries++;
                entries.push(entry);
            }
            entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
            for (const entry of entries) {
                if (files.length >= maxFiles) { scanLimited = true; break; }
                const file = path.join(directory, entry.name);
                if (entry.isDirectory() && !isSkippedSourceDirectory(entry.name)) {
                    if (visitedEntries >= MAX_ENTRIES) { scanLimited = true; continue; }
                    await walk(file, level + 1);
                } else if (entry.isFile() && isSourceFile(entry.name)) files.push(file);
            }
        } catch {
            issue(directory, "directory unreadable");
        }
    };
    await walk(root, 0);
    files.sort();
    const discovered = new Set(files);
    if (!discovered.has(focus)) throw Error("file was not discovered; check exclusions, symbolic links and maxFiles");
    const edges: DependencyEdge[] = [];
    const unresolved: UnresolvedDependency[] = [];
    let unresolvedCount = 0;
    let focusUnresolved = 0;
    const unavailable = (file: string, line: number, reason: string, specifier?: string) => {
        unresolvedCount++;
        if (file !== focus) return;
        focusUnresolved++;
        if (unresolved.length < limit) unresolved.push({ file: relative(file), line, reason,
            ...(specifier === undefined ? {} : { specifier: specifier.slice(0, 200) }) });
    };
    const aliases = new Map<string, Awaited<ReturnType<typeof loadPathAliases>>>();
    const resolvedPaths = new Map<string, string | undefined>();
    let bytesRead = 0;
    let indexedFiles = 0;
    let references = 0;
    let edgesLimited = false;
    const { parse, traverse } = await loadBabel();
    for (const file of files) {
        if (bytesRead >= MAX_TOTAL_BYTES || references >= MAX_EDGES) { scanLimited = true; break; }
        let ast: any;
        try {
            const buffer = await readBounded(file, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - bytesRead), bytes => { bytesRead += bytes; });
            ast = parse(buffer.toString("utf8"), PARSE_OPTIONS);
            if (ast.errors?.length) throw Error("parse error");
        } catch (error) {
            issue(file, error instanceof Error && error.message === "source byte limit" ? error.message : "unreadable or unparseable source");
            continue;
        }
        indexedFiles++;
        const requests: ImportRequest[] = [];
        traverse(ast, {
            enter(p: any) {
                const request = importRequest(p);
                if (!request) return;
                if (references >= MAX_EDGES) { edgesLimited = true; p.stop(); return; }
                references++;
                requests.push(request);
            }
        });
        const directory = path.dirname(file);
        for (const request of requests) {
            const { specifier, line, kind, typeOnly } = request;
            if (request.unsupported || specifier === undefined) {
                unavailable(file, line, request.unsupported ?? "nonliteral dynamic import");
                continue;
            }
            const key = `${directory}\0${specifier}`;
            if (!resolvedPaths.has(key)) {
                if (!aliases.has(directory)) aliases.set(directory, await loadPathAliases(directory));
                const candidates = specifier.startsWith(".") ? [path.resolve(directory, specifier)] : aliases.get(directory)!(specifier);
                let target: string | undefined;
                for (const candidate of candidates) {
                    if (!within(root, candidate) || candidate.split(path.sep).includes("node_modules")) continue;
                    target = await resolveModule(path.dirname(candidate), `./${path.basename(candidate)}`);
                    if (target) break;
                }
                resolvedPaths.set(key, target ? await fs.realpath(target).catch(() => undefined) : undefined);
            }
            const target = resolvedPaths.get(key);
            if (!target || !discovered.has(target)) {
                unavailable(file, line, target ? "target outside discovered source files" : "external, out-of-root or unresolved import", specifier);
                continue;
            }
            edges.push({ from: relative(file), to: relative(target), line, kind, ...(typeOnly ? { typeOnly } : {}) });
        }
    }
    edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.line - b.line);
    const file = relative(focus);
    const neighbors = [...findNeighbors(edges, file, depth, false).map(neighbor => ({ direction: "dependency", neighbor })),
        ...findNeighbors(edges, file, depth, true).map(neighbor => ({ direction: "dependent", neighbor }))]
        .sort((a, b) => a.neighbor.via.length - b.neighbor.via.length || a.neighbor.file.localeCompare(b.neighbor.file) || a.direction.localeCompare(b.direction));
    const selected = neighbors.slice(0, limit);
    const result = {
        file, depth,
        scope: "Static file relationships, not runtime calls or test coverage. Tests are identified by path convention.",
        dependencies: selected.filter(n => n.direction === "dependency").map(n => n.neighbor),
        dependents: selected.filter(n => n.direction === "dependent").map(n => n.neighbor),
        totalNeighbors: neighbors.length, returned: selected.length,
        truncated: neighbors.length > selected.length || unresolved.length < focusUnresolved || issues.length < issueCount,
        unresolved, issues,
        coverage: { discoveredFiles: files.length, indexedFiles, visitedEntries, bytesRead,
            edges: edges.length, unresolved: unresolvedCount, focusUnresolved, issues: issueCount,
            scanLimited: scanLimited || edgesLimited }
    };
    while (JSON.stringify(result).length > MAX_REPLY_CHARS) {
        result.truncated = true;
        if (result.dependencies.length || result.dependents.length) {
            if (result.dependencies.length >= result.dependents.length) result.dependencies.pop();
            else result.dependents.pop();
            result.returned--;
        } else if (result.unresolved.length) result.unresolved.pop();
        else if (result.issues.length) result.issues.pop();
        else throw Error("file path exceeds response budget");
    }
    return result;
}
