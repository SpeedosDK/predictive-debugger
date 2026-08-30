import fs from "fs/promises";
import path from "path";
import { loadBabel, PARSE_OPTIONS } from "./ast";

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
}

interface CallSite {
    /** Local binding the call resolves through. */
    local: string;
    /** For `ns.foo()` on a namespace import, the member being called. */
    member?: string;
    order: number;
}

/**
 * Resolve, one hop, the definitions of imported functions `code` calls.
 *
 * Deliberately not transitive: one hop covers "the callee already handles this"
 * dismissals, which is the class of false positive this addresses, and each
 * further hop multiplies both the token cost and the chance of burying the file
 * actually under review.
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
    const sourceCache = new Map<string, string | undefined>();
    const collected: CalleeContext[] = [];
    let spent = 0;

    for (const { name, binding } of wanted) {
        if (collected.length >= MAX_CALLEES || spent >= MAX_TOTAL_CALLEE_CHARS) {
            break;
        }

        const resolved = await resolveModule(dir, binding.source);
        // A bare specifier resolves to nothing on purpose: `node_modules` is
        // both enormous and, being third-party, the one place where "the
        // callee already handles this" is a documented contract rather than
        // something to read off the source.
        if (!resolved || resolved === path.resolve(filePath)) {
            continue;
        }

        if (!sourceCache.has(resolved)) {
            sourceCache.set(resolved, await fs.readFile(resolved, "utf8").catch(() => undefined));
        }
        const dependency = sourceCache.get(resolved);
        if (dependency === undefined) {
            continue;
        }

        const definition = await findExportedDefinition(dependency, binding.imported, name);
        if (!definition) {
            continue;
        }

        const budget = Math.min(MAX_CALLEE_CHARS, MAX_TOTAL_CALLEE_CHARS - spent);
        // A cut so short it cannot even show the signature is worse than no
        // entry at all: it spends tokens to tell the model nothing.
        if (budget < 120) {
            break;
        }

        const excerpted = definition.length > budget;
        const source = excerpted ? `${cutAtLineBoundary(definition, budget)}\n  /* … */` : definition;

        spent += source.length;
        collected.push({
            name,
            from: relativeSpecifier(dir, resolved),
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
                // A type-only import cannot be called at runtime, so resolving
                // it would spend the budget on something the verdict can never
                // turn on.
                if (path.node.importKind === "type" || specifier.importKind === "type") {
                    continue;
                }
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
        CallExpression(path: any) {
            const callee = path.node.callee;
            if (callee.type === "Identifier") {
                calls.push({ local: callee.name, order: order++ });
            } else if (
                callee.type === "MemberExpression" &&
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

        // `client.get()` where `client` is an imported object is a method on a
        // value, not the imported function itself — the definition we would
        // find is the object, which is not what was called.
        if (call.member) {
            continue;
        }

        record(counts, call.local, binding, call.order);
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
 * Pull the source of one exported binding out of a dependency.
 *
 * Follows `export { local as exported }` back to the local declaration, because
 * a barrel-style re-export inside the same file is bookkeeping, not a second
 * hop. It does not follow `export { x } from "./y"`, which is one.
 */
async function findExportedDefinition(
    code: string,
    imported: string,
    callName: string
): Promise<string | undefined> {
    let ast: any;
    try {
        const { parse } = await loadBabel();
        ast = parse(code, PARSE_OPTIONS);
    } catch {
        return undefined;
    }

    const declarations = new Map<string, { start: number; end: number; prefix: string }>();
    const aliases = new Map<string, string>();
    let defaultRange: { start: number; end: number; prefix: string } | undefined;

    const collect = (node: any, exportedNames: Set<string>): void => {
        if (!node) {
            return;
        }
        if (
            node.type === "FunctionDeclaration" ||
            node.type === "ClassDeclaration" ||
            node.type === "TSDeclareFunction"
        ) {
            if (node.id?.name) {
                declarations.set(node.id.name, { start: node.start, end: node.end, prefix: "" });
                exportedNames.add(node.id.name);
            }
            return;
        }
        if (node.type === "VariableDeclaration") {
            for (const declarator of node.declarations) {
                if (declarator.id?.type === "Identifier") {
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
            // `export { a } from "./b"` is a second hop; only the local form
            // resolves here.
            if (!node.source) {
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
            } else if (typeof declaration?.start === "number") {
                defaultRange = {
                    start: declaration.start,
                    end: declaration.end,
                    prefix: `const ${callName} = `
                };
            }
            continue;
        }
        collect(node, new Set());
    }

    if (imported === "default") {
        // `export default function foo()` is exported by construction, so the
        // `exported` check below does not apply to this branch.
        const aliased = aliases.get("default");
        const range = aliased ? declarations.get(aliased) : defaultRange;
        return range ? slice(code, range) : undefined;
    }

    const local = aliases.get(imported) ?? imported;
    const range = declarations.get(local);
    // Only report what the module actually exports: a name that matches a
    // private helper is a coincidence, and showing it would be misleading.
    if (!range || (!exported.has(local) && !aliases.has(imported))) {
        return undefined;
    }
    return slice(code, range);
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
