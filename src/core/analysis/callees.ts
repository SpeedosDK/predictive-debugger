import fs from "fs/promises";
import path from "path";
import { loadBabel, PARSE_OPTIONS } from "./ast";
import { loadPathAliases } from "./modulePaths";

/**
 * One imported function the analysed file calls, with the source of its
 * definition.
 *
 * This exists because single-file scope produced a false positive that was
 * attributable to it entirely: the disproof of the flagged claim was that a
 * callee was idempotent, and that callee was one import away. The evidence
 * policy in `predictBug` asks the model to disprove a candidate before
 * reporting it; without the callee's body it has nothing to disprove it with,
 * so it assumes the worst about code it cannot see. See issue #4.
 */
export interface CalleeContext {
    /** The name as it is called in the analysed file. */
    name: string;
    /** Where the definition came from, relative to the analysed file. */
    from: string;
    /** The definition's source text, cut to the budget below when oversized. */
    source: string;
    /** Set when the body was cut, so the prompt can say so rather than imply completeness. */
    excerpted?: boolean;
}

/**
 * Budgets for the extra prompt context, measured in characters.
 *
 * Callee bodies are pure added cost on every `predict_failures` call, paid
 * whether or not the verdict turns on one. ~16k characters is roughly 4k input
 * tokens, about an eighth of what a 120k-character file already costs, which
 * keeps the addition proportionate to the source it is supporting.
 *
 * The per-callee cap is what makes the total predictable: without it a single
 * 900-line exported service method would consume the whole budget and crowd out
 * the six small helpers that are likelier to carry a guard.
 */
const MAX_CALLEES = 12;
const MAX_CALLEE_CHARS = 3_000;
const MAX_TOTAL_CALLEE_CHARS = 16_000;

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

interface ImportBinding {
    /** The module specifier as written. */
    source: string;
    /** The name exported by that module, or "default", or "*" for a namespace. */
    imported: string;
    member?: string;
}

interface CallSite {
    /** Local binding the call resolves through. */
    local: string;
    /** For `ns.foo()` on a namespace import, the member being called. */
    member?: string;
    order: number;
    typeOnly?: boolean;
}

/**
 * Resolve imported calls and referenced type contracts within a fixed context budget.
 *
 * Follows at most four files through explicit re-exports, without following
 * calls inside dependencies. Cycles and large dependencies yield less context.
 *
 * Never throws. An unresolvable import, an unreadable file, or a syntax error
 * in a dependency yields fewer callees, not a failed prediction — this is
 * supporting context, and losing it costs precision rather than correctness.
 */
export async function collectCalleeContext(
    filePath: string,
    code: string
): Promise<CalleeContext[]> {
    let imports: Map<string, ImportBinding>;
    let calls: CallSite[];

    try {
        ({ imports, calls } = await readCallGraph(code));
    } catch {
        return [];
    }

    if (imports.size === 0 || calls.length === 0) {
        return [];
    }

    const wanted = rankCallees(imports, calls);
    const dir = path.dirname(path.resolve(filePath));
    const definitionCache = new Map<string, Awaited<ReturnType<typeof readExportedDefinitions>>>();
    const resolutionCache = new Map<string, string | undefined>();
    const aliases = await loadPathAliases(dir);
    const collected: CalleeContext[] = [];
    const resolve = async (fromDir: string, specifier: string) => {
        const key = `${fromDir}\0${specifier}`;
        if (!resolutionCache.has(key)) {
            let resolved: string | undefined;
            const candidates = specifier.startsWith(".")
                ? [path.resolve(fromDir, specifier)] : aliases(specifier);
            for (const candidate of candidates) {
                if (candidate.split(path.sep).includes("node_modules")) continue;
                resolved = await resolveModule(path.dirname(candidate), `./${path.basename(candidate)}`);
                if (resolved) break;
            }
            resolutionCache.set(key, resolved);
        }
        return resolutionCache.get(key);
    };
    const definitionFor = async (
        fromDir: string, binding: ImportBinding, name: string, seen = new Set<string>()
    ): Promise<{ source: string; file: string } | undefined> => {
        const resolved = await resolve(fromDir, binding.source);
        if (!resolved || resolved === path.resolve(filePath) || seen.has(resolved) || seen.size >= 4) return undefined;
        seen.add(resolved);
        if (!definitionCache.has(resolved)) {
            if (definitionCache.size >= 24) return undefined;
            const dependency = await fs.stat(resolved).then(stat => stat.size <= 4 * 1024 * 1024
                ? fs.readFile(resolved, "utf8") : undefined).catch(() => undefined);
            definitionCache.set(resolved, dependency === undefined ? undefined : await readExportedDefinitions(dependency));
        }
        const definition = definitionCache.get(resolved)?.(binding.imported, name, binding.member);
        if (typeof definition === "string") return { source: definition, file: resolved };
        if (definition) return definitionFor(path.dirname(resolved), { ...definition, member: binding.member }, name, seen);
        return undefined;
    };
    const totalBudget = Math.min(MAX_TOTAL_CALLEE_CHARS, Math.max(1_000, code.length));
    let spent = 0;

    for (const { name, binding } of wanted) {
        if (collected.length >= MAX_CALLEES || spent >= totalBudget) {
            break;
        }

        const resolved = await definitionFor(dir, binding, name);
        if (!resolved) continue;
        const definition = resolved.source;

        const budget = Math.min(MAX_CALLEE_CHARS, totalBudget - spent);
        // A cut so short it cannot even show the signature is worse than no
        // entry at all: it spends tokens to tell the model nothing.
        if (budget < 120) {
            break;
        }

        const excerpted = definition.length > budget;
        const source = excerpted ? `${cutAtLineBoundary(definition, budget - 12)}\n  /* … */` : definition;

        spent += source.length;
        collected.push({
            name,
            from: relativeSpecifier(dir, resolved.file),
            source,
            ...(excerpted ? { excerpted: true } : {})
        });
    }

    return collected;
}

/** Import bindings and the calls that go through them, in one parse. */
async function readCallGraph(
    code: string
): Promise<{ imports: Map<string, ImportBinding>; calls: CallSite[] }> {
    const { parse, traverse } = await loadBabel();
    const ast = parse(code, PARSE_OPTIONS);

    const imports = new Map<string, ImportBinding>();
    const calls: CallSite[] = [];
    let order = 0;

    traverse(ast, {
        ImportDeclaration(path: any) {
            const source = path.node.source.value;
            if (typeof source !== "string") {
                return;
            }
            for (const specifier of path.node.specifiers) {
                const local = specifier.local.name;
                if (specifier.type === "ImportDefaultSpecifier") {
                    imports.set(local, { source, imported: "default" });
                } else if (specifier.type === "ImportNamespaceSpecifier") {
                    imports.set(local, { source, imported: "*" });
                } else if (specifier.type === "ImportSpecifier") {
                    const imported =
                        specifier.imported.type === "Identifier"
                            ? specifier.imported.name
                            : specifier.imported.value;
                    imports.set(local, { source, imported });
                }
            }
        },
        TSTypeReference(path: any) {
            const name = path.node.typeName;
            if (name.type !== "Identifier") return;
            if (path.findParent((parent: any) =>
                parent.node.typeParameters?.params?.some((parameter: any) => (parameter.name?.name ?? parameter.name) === name.name) ||
                (parent.isBlockStatement() && parent.node.body.some((node: any) =>
                    (node.type === "TSTypeAliasDeclaration" || node.type === "TSInterfaceDeclaration") && node.id.name === name.name)))) return;
            const binding = path.scope.getBinding(name.name);
            if (!binding || !binding.path.parentPath?.isImportDeclaration()) return;
            calls.push({ local: name.name, order: order++, typeOnly: true });
        },
        "CallExpression|OptionalCallExpression"(path: any) {
            const callee = path.node.callee;
            const local = callee.type === "Identifier" ? callee.name
                : (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && callee.object.type === "Identifier"
                    ? callee.object.name : undefined;
            const binding = local ? path.scope.getBinding(local) : undefined;
            if (!binding || !binding.path.parentPath?.isImportDeclaration()) {
                return;
            }
            if (callee.type === "Identifier") {
                calls.push({ local: callee.name, order: order++ });
            } else if (
                (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
                !callee.computed &&
                callee.object.type === "Identifier" &&
                callee.property.type === "Identifier"
            ) {
                calls.push({
                    local: callee.object.name,
                    member: callee.property.name,
                    order: order++
                });
            }
        }
    } as any);

    return { imports, calls };
}

/**
 * Order the callees by how many times the file calls each one.
 *
 * Only matters once the budget binds, and then it is the right tiebreak: a
 * helper invoked from four places is load-bearing in a way that one called once
 * from a logging branch is not. First-call order settles ties so the output is
 * deterministic.
 */
function rankCallees(
    imports: Map<string, ImportBinding>,
    calls: CallSite[]
): Array<{ name: string; binding: ImportBinding }> {
    const counts = new Map<string, { name: string; binding: ImportBinding; hits: number; first: number }>();

    for (const call of calls) {
        const binding = imports.get(call.local);
        if (!binding) {
            continue;
        }

        // `import * as ns` is only usable one hop deep through a member call:
        // `ns.foo()` names the export, `ns()` names nothing.
        if (binding.imported === "*") {
            if (!call.member) {
                continue;
            }
            record(counts, `${call.local}.${call.member}`, { source: binding.source, imported: call.member }, call.order);
            continue;
        }

        record(counts, call.member ? `${call.local}.${call.member}` : call.local,
            { ...binding, member: call.member }, call.typeOnly ? calls.length + call.order : call.order);
    }

    return [...counts.values()]
        .sort((a, b) => b.hits - a.hits || a.first - b.first)
        .map(({ name, binding }) => ({ name, binding }));
}

function record(
    counts: Map<string, { name: string; binding: ImportBinding; hits: number; first: number }>,
    name: string,
    binding: ImportBinding,
    order: number
): void {
    const existing = counts.get(name);
    if (existing) {
        existing.hits++;
    } else {
        counts.set(name, { name, binding, hits: 1, first: order });
    }
}

/** Try the extension candidates, then the directory's index file. */
async function resolveModule(fromDir: string, specifier: string): Promise<string | undefined> {
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

/**
 * Index a dependency once and return a lookup for its exported source.
 *
 * Follows `export { local as exported }` back to the local declaration, because
 * a barrel-style re-export inside the same file is bookkeeping, not a second
 * hop. External aliases are returned for bounded resolution by the caller.
 */
async function readExportedDefinitions(
    code: string
): Promise<((imported: string, callName: string, member?: string) => string | ImportBinding | undefined) | undefined> {
    let ast: any;
    try {
        const { parse } = await loadBabel();
        ast = parse(code, PARSE_OPTIONS);
    } catch {
        return undefined;
    }

    const declarations = new Map<string, { start: number; end: number; prefix: string }>();
    const aliases = new Map<string, string>();
    const reexports = new Map<string, ImportBinding>();
    const nodes = new Map<string, any>();
    let defaultRange: { start: number; end: number; prefix: string } | undefined;

    const collect = (node: any, exportedNames: Set<string>): void => {
        if (!node) {
            return;
        }
        if (
            node.type === "FunctionDeclaration" ||
            node.type === "ClassDeclaration" ||
            node.type === "TSDeclareFunction" ||
            node.type === "TSInterfaceDeclaration" || node.type === "TSTypeAliasDeclaration"
        ) {
            if (node.id?.name) {
                nodes.set(node.id.name, node);
                declarations.set(node.id.name, { start: node.start, end: node.end, prefix: "" });
                exportedNames.add(node.id.name);
            }
            return;
        }
        if (node.type === "VariableDeclaration") {
            for (const declarator of node.declarations) {
                if (declarator.id?.type === "Identifier") {
                    nodes.set(declarator.id.name, declarator.init);
                    declarations.set(declarator.id.name, {
                        start: declarator.start,
                        end: declarator.end,
                        // Restored so the excerpt reads as a declaration rather
                        // than a bare initialiser.
                        prefix: `${node.kind} `
                    });
                    exportedNames.add(declarator.id.name);
                }
            }
        }
    };

    const exported = new Set<string>();
    for (const node of ast.program.body) {
        if (node.type === "ExportNamedDeclaration") {
            if (node.declaration) {
                collect(node.declaration, exported);
            }
            if (node.source) {
                for (const specifier of node.specifiers) {
                    if (specifier.type === "ExportSpecifier") {
                        reexports.set(specifier.exported.name ?? specifier.exported.value,
                            { source: node.source.value, imported: specifier.local.name ?? specifier.local.value });
                    }
                }
            } else {
                for (const specifier of node.specifiers) {
                    if (specifier.type === "ExportSpecifier") {
                        const name =
                            specifier.exported.type === "Identifier"
                                ? specifier.exported.name
                                : specifier.exported.value;
                        aliases.set(name, specifier.local.name);
                    }
                }
            }
            continue;
        }
        if (node.type === "ExportDefaultDeclaration") {
            const declaration = node.declaration;
            if (declaration?.id?.name) {
                aliases.set("default", declaration.id.name);
                collect(declaration, exported);
            } else if (declaration?.type === "Identifier") {
                // `export default foo;` names a declaration made elsewhere in
                // the file, exactly like a named alias does. Without this the
                // range below covered the bare identifier, so the excerpt sent
                // to the model was `const foo = foo` -- worse than sending
                // nothing, since it burns tokens to say that a function is
                // itself.
                aliases.set("default", declaration.name);
            } else if (typeof declaration?.start === "number") {
                defaultRange = {
                    start: declaration.start,
                    end: declaration.end,
                    prefix: ""
                };
            }
            continue;
        }
        collect(node, new Set());
    }

    return (imported, callName, member) => {
        if (reexports.has(imported)) return reexports.get(imported);
        if (member) {
            const local = aliases.get(imported) ?? imported;
            const node = nodes.get(local);
            const members = node?.type === "ObjectExpression" ? node.properties :
                node?.type === "ClassDeclaration" ? node.body.body.filter((entry: any) => entry.static) : [];
            if (!members.some((entry: any) => !entry.computed &&
                (entry.key?.name ?? entry.key?.value) === member)) return undefined;
        }
        if (imported === "default") {
            const aliased = aliases.get("default");
            const range = aliased ? declarations.get(aliased) : defaultRange;
            if (!range) {
                return undefined;
            }
            const prefix = aliased ? "" : `const ${callName} = `;
            return `${prefix}${slice(code, range)}`;
        }
        const local = aliases.get(imported) ?? imported;
        const range = declarations.get(local);
        if (!range || (!exported.has(local) && !aliases.has(imported))) {
            return undefined;
        }
        return slice(code, range);
    };
}

function slice(code: string, range: { start: number; end: number; prefix: string }): string {
    return `${range.prefix}${code.slice(range.start, range.end)}`;
}

function cutAtLineBoundary(text: string, limit: number): string {
    const cut = text.slice(0, limit);
    const lastBreak = cut.lastIndexOf("\n");
    return lastBreak === -1 ? cut : cut.slice(0, lastBreak);
}

/** Render the resolved path the way the import was written, for the prompt. */
function relativeSpecifier(fromDir: string, target: string): string {
    const relative = path.relative(fromDir, target).replace(/\\/g, "/");
    return relative.startsWith(".") ? relative : `./${relative}`;
}
