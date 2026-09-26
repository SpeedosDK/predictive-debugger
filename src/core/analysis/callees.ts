import fs from "fs/promises";
import path from "path";
import { loadBabel, PARSE_OPTIONS } from "./ast";
import { loadPathAliases } from "./modulePaths";
import { resolveModule } from "./moduleResolution";
import { selectMemberContext } from "./memberContext";

/**
 * An imported definition or type contract used by the analysed file.
 * The model needs dependency evidence to check whether a callee already handles
 * a suspected failure; a single-file prompt cannot establish that contract.
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
    /**
     * The module provably does not export this name, so the import is undefined at
     * runtime. Only set for CommonJS modules whose whole `module.exports` is known.
     */
    missing?: true;
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

interface ImportBinding {
    /** The module specifier as written. */
    source: string;
    /** The name exported by that module, or "default", or "*" for a namespace. */
    imported: string;
    member?: string;
    /** `export default identifier` copies a value rather than forwarding a binding. */
    snapshot?: string;
}

interface ExportDefinition {
    local: string;
    text?: string;
    excerpted?: boolean;
}

interface ResolvedDefinition {
    identity: string;
    file: string;
    source?: string;
    excerpted?: boolean;
}

type DefinitionResolution = ResolvedDefinition | { absent: string } | "missing" | "unknown";

// Missing exports allow another wildcard branch to resolve; unknown exports
// cannot rule out a conflicting binding and must stop resolution.
// "absent" is stronger than "missing": the module's complete export list is known
// and lacks the name, which is itself evidence for the model, not just no context.
type ExportLookupResult = ExportDefinition | ImportBinding | { stars: string[] } | "absent" | "missing" | "unknown";
type ExportLookup = (imported: string, callName: string, budget: number, member?: string) => ExportLookupResult;

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
 * Follows at most four files through re-exports, without following
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
    const definitionCache = new Map<string, ExportLookup | undefined>();
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
        fromDir: string, binding: ImportBinding, name: string, budget: number,
        seen = new Set<string>(), work = { remaining: 128 }
    ): Promise<DefinitionResolution> => {
        if (work.remaining-- <= 0) return "unknown";
        const resolved = await resolve(fromDir, binding.source);
        if (!resolved || resolved === path.resolve(filePath)) return "unknown";
        const key = `${resolved}\0${binding.imported}`;
        if (seen.has(key)) return "missing";
        if (seen.size >= 4) return "unknown";
        const next = new Set(seen).add(key);
        if (!definitionCache.has(resolved)) {
            if (definitionCache.size >= 24) return "unknown";
            const dependency = await fs.stat(resolved).then(stat => stat.size <= 4 * 1024 * 1024
                ? fs.readFile(resolved, "utf8") : undefined).catch(() => undefined);
            definitionCache.set(resolved, dependency === undefined ? undefined : await readExportedDefinitions(dependency));
        }
        const lookup = definitionCache.get(resolved);
        if (!lookup) return "unknown";
        const definition = lookup(binding.imported, name, budget, binding.member);
        if (definition === "absent") return { absent: resolved };
        if (typeof definition === "string") return definition;
        if ("local" in definition) return { identity: `${resolved}\0${definition.local}`,
            source: definition.text, file: resolved, excerpted: definition.excerpted };
        if ("stars" in definition) {
            let found: DefinitionResolution = "missing";
            for (const source of definition.stars) {
                const candidate = await definitionFor(path.dirname(resolved), { ...binding, source }, name, budget, next, work);
                // An unreadable branch might export a conflicting binding. Absence
                // and uncertainty must stay distinct when checking star exports.
                if (candidate === "unknown") return "unknown";
                if (candidate === "missing" || "absent" in candidate) continue;
                if (typeof found !== "string" && found.identity !== candidate.identity) return "unknown";
                found = candidate;
            }
            return found;
        }
        const forwarded = await definitionFor(path.dirname(resolved), { ...definition, member: binding.member }, name, budget, next, work);
        return typeof forwarded !== "string" && definition.snapshot
            ? { ...forwarded, identity: `${resolved}\0${definition.snapshot}` } : forwarded;
    };
    const totalBudget = Math.min(MAX_TOTAL_CALLEE_CHARS, Math.max(1_000, code.length));
    let spent = 0;

    for (const { name, binding } of wanted) {
        if (collected.length >= MAX_CALLEES || spent >= totalBudget) {
            break;
        }

        const budget = Math.min(MAX_CALLEE_CHARS, totalBudget - spent);
        // A cut so short it cannot even show the signature is worse than no
        // entry at all: it spends tokens to tell the model nothing.
        if (budget < 120) {
            break;
        }

        const resolved = await definitionFor(dir, binding, name, budget);
        if (typeof resolved === "string") continue;
        if ("absent" in resolved) {
            const note = `/* not exported: this module's module.exports does not include "${binding.imported}" */`;
            spent += note.length;
            collected.push({ name, from: relativeSpecifier(dir, resolved.absent), source: note, missing: true });
            continue;
        }
        if (resolved.source === undefined) continue;
        const definition = resolved.source;
        const cut = definition.length > budget;
        const excerpted = resolved.excerpted || cut;
        const source = cut ? `${cutAtLineBoundary(definition, budget - 12)}\n  /* … */` : definition;

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
        VariableDeclarator(path: any) {
            const init = path.node.init;
            let source = requireSource(init);
            let member: string | undefined;
            if (!source && init?.type === "MemberExpression" && !init.computed && init.property.type === "Identifier") {
                source = requireSource(init.object);
                member = init.property.name;
            }
            if (!source) return;
            const id = path.node.id;
            if (id.type === "Identifier") {
                imports.set(id.name, { source, imported: member ?? "*" });
            } else if (id.type === "ObjectPattern" && !member) {
                for (const property of id.properties) {
                    if (property.type !== "ObjectProperty" || property.computed) continue;
                    const imported = property.key.name ?? property.key.value;
                    const value = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
                    if (typeof imported === "string" && value.type === "Identifier") imports.set(value.name, { source, imported });
                }
            }
        },
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
            if (!binding || !isImportBinding(binding)) return;
            calls.push({ local: name.name, order: order++, typeOnly: true });
        },
        "CallExpression|OptionalCallExpression|NewExpression"(path: any) {
            const callee = path.node.callee;
            const local = callee.type === "Identifier" ? callee.name
                : (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && callee.object.type === "Identifier"
                    ? callee.object.name : undefined;
            const binding = local ? path.scope.getBinding(local) : undefined;
            if (!binding || !isImportBinding(binding)) {
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

/** `require("./x")` with a literal specifier. */
function requireSource(node: any): string | undefined {
    return node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require" &&
        node.arguments.length === 1 && node.arguments[0].type === "StringLiteral" ? node.arguments[0].value : undefined;
}

/** An ES import, or a declaration initialised from `require(...)` or `require(...).name`. */
function isImportBinding(binding: any): boolean {
    if (binding.path.parentPath?.isImportDeclaration()) return true;
    const init = binding.path.isVariableDeclarator() ? binding.path.node.init : undefined;
    return requireSource(init) !== undefined || (init?.type === "MemberExpression" && requireSource(init.object) !== undefined);
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

/**
 * Index a dependency once and return a lookup for its exported source.
 *
 * Follows `export { local as exported }` back to the local declaration, because
 * a barrel-style re-export inside the same file is bookkeeping, not a second
 * hop. External aliases are returned for bounded resolution by the caller.
 */
async function readExportedDefinitions(
    code: string
): Promise<ExportLookup | undefined> {
    let ast: any;
    try {
        const { parse } = await loadBabel();
        ast = parse(code, PARSE_OPTIONS);
        if (ast.errors?.length) return undefined;
        if (ast.program.sourceType !== "module") return await readCommonJsExports(ast, code);
    } catch {
        return undefined;
    }

    const declarations = new Map<string, { start: number; end: number; prefix: string }>();
    const aliases = new Map<string, string>();
    const reexports = new Map<string, ImportBinding>();
    const imports = new Map<string, ImportBinding>();
    const stars = new Set<string>();
    const unsupported = new Set<string>();
    const nodes = new Map<string, any>();
    let defaultRange: { start: number; end: number; prefix: string } | undefined;
    let defaultSnapshot = false;

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
                } else {
                    const names = (pattern: any): void => {
                        if (!pattern) return;
                        if (pattern.type === "Identifier") exportedNames.add(pattern.name);
                        else if (pattern.type === "ObjectPattern") pattern.properties.forEach((entry: any) =>
                            names(entry.type === "RestElement" ? entry.argument : entry.value));
                        else if (pattern.type === "ArrayPattern") pattern.elements.forEach(names);
                        else if (pattern.type === "AssignmentPattern") names(pattern.left);
                        else if (pattern.type === "RestElement") names(pattern.argument);
                    };
                    names(declarator.id);
                }
            }
        }
        if (node.id?.name) exportedNames.add(node.id.name);
    };

    const exported = new Set<string>();
    for (const node of ast.program.body) {
        if (node.type === "ImportDeclaration") {
            for (const specifier of node.specifiers) {
                const imported = specifier.type === "ImportDefaultSpecifier" ? "default"
                    : specifier.type === "ImportNamespaceSpecifier" ? "*"
                    : specifier.imported.name ?? specifier.imported.value;
                imports.set(specifier.local.name, { source: node.source.value, imported });
            }
            continue;
        }
        if (node.type === "ExportAllDeclaration") {
            stars.add(node.source.value);
            continue;
        }
        if (node.type === "ExportNamedDeclaration") {
            if (node.declaration) {
                collect(node.declaration, exported);
            }
            if (node.source) {
                for (const specifier of node.specifiers) {
                    if (specifier.type === "ExportSpecifier") {
                        reexports.set(specifier.exported.name ?? specifier.exported.value,
                            { source: node.source.value, imported: specifier.local.name ?? specifier.local.value });
                    } else unsupported.add(specifier.exported.name ?? specifier.exported.value);
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
                collect(declaration, new Set());
            } else if (declaration?.type === "Identifier") {
                // `export default foo;` names a declaration made elsewhere in
                // the file, exactly like a named alias does. Without this the
                // range below covered the bare identifier, so the excerpt sent
                // to the model was `const foo = foo` -- worse than sending
                // nothing, since it burns tokens to say that a function is
                // itself.
                aliases.set("default", declaration.name);
                defaultSnapshot = true;
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

    return (imported, callName, budget, member) => {
        const reexport = reexports.get(imported);
        if (reexport) return reexport;
        if (unsupported.has(imported)) return "unknown";
        const local = aliases.get(imported) ?? imported;
        if (aliases.has(imported) && imports.has(local)) {
            const binding = imports.get(local)!;
            if (binding.imported === "*") return "unknown";
            return { ...binding, ...(imported === "default" && defaultSnapshot ? { snapshot: "*default*" } : {}) };
        }
        const explicit = exported.has(imported) || aliases.has(imported) || imported === "default" && defaultRange;
        if (!explicit) return imported !== "default" && stars.size ? { stars: [...stars] } : "missing";
        const identity = imported === "default" && defaultSnapshot ? "*default*" : local;
        if (member) {
            const node = nodes.get(local);
            const members = node?.type === "ObjectExpression" ? node.properties :
                node?.type === "ClassDeclaration" ? node.body.body.filter((entry: any) => entry.static) : [];
            if (!members.some((entry: any) => !entry.computed &&
                (entry.key?.name ?? entry.key?.value) === member)) return { local: identity };
        }
        if (imported === "default") {
            const aliased = aliases.get("default");
            const range = aliased ? declarations.get(aliased) : defaultRange;
            if (!range) {
                return { local: identity };
            }
            const prefix = aliased ? "" : `const ${callName} = `;
            return { local: identity, ...(member ? selectMemberContext(code, nodes.get(aliased!), member, range, budget, aliased!)
                : { text: `${prefix}${slice(code, range)}` }) };
        }
        const range = declarations.get(local);
        if (!range || (!exported.has(local) && !aliases.has(imported))) {
            return { local: identity };
        }
        return { local: identity, ...(member ? selectMemberContext(code, nodes.get(local), member, range, budget, local)
            : { text: slice(code, range) }) };
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

/**
 * Index a CommonJS module's exports: `module.exports = { ... }`, `module.exports.x =`
 * and `exports.x =` at the top level. A name is reported absent only when the whole
 * export surface is one object literal without spreads and nothing else touches
 * `module.exports` or `exports`; any other shape answers "unknown", never absent.
 */
async function readCommonJsExports(ast: any, code: string): Promise<ExportLookup> {
    const { traverse } = await loadBabel();
    const declarations = new Map<string, { start: number; end: number; prefix: string }>();
    const exported = new Map<string, { local?: string; range?: { start: number; end: number; prefix: string } }>();
    const consumed = new Set<number>();
    let complete = false;
    let opaque = false;
    const isModuleExports = (node: any) => node?.type === "MemberExpression" && !node.computed &&
        node.object.type === "Identifier" && node.object.name === "module" &&
        node.property.type === "Identifier" && node.property.name === "exports";
    const namedTarget = (node: any): string | undefined => node?.type === "MemberExpression" && !node.computed &&
        node.property.type === "Identifier" && (isModuleExports(node.object) ||
            (node.object.type === "Identifier" && node.object.name === "exports")) ? node.property.name : undefined;

    for (const node of ast.program.body) {
        if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
            if (node.id?.name) declarations.set(node.id.name, { start: node.start, end: node.end, prefix: "" });
            continue;
        }
        if (node.type === "VariableDeclaration") {
            for (const declarator of node.declarations) {
                if (declarator.id?.type === "Identifier") {
                    declarations.set(declarator.id.name, { start: declarator.start, end: declarator.end, prefix: `${node.kind} ` });
                }
            }
            continue;
        }
        const assignment = node.type === "ExpressionStatement" && node.expression.type === "AssignmentExpression" &&
            node.expression.operator === "=" ? node.expression : undefined;
        if (!assignment) continue;
        const value = assignment.right;
        if (isModuleExports(assignment.left)) {
            consumed.add(assignment.left.start);
            if (value.type !== "ObjectExpression") { opaque = true; continue; }
            complete = true;
            for (const property of value.properties) {
                const key = property.computed ? undefined : property.key?.name ?? property.key?.value;
                if (property.type === "SpreadElement" || typeof key !== "string") { opaque = true; continue; }
                exported.set(key, property.type === "ObjectProperty" && property.value.type === "Identifier"
                    ? { local: property.value.name } : { range: { start: property.start, end: property.end, prefix: "" } });
            }
            continue;
        }
        const name = namedTarget(assignment.left);
        if (name) {
            consumed.add(assignment.left.object.start);
            exported.set(name, value.type === "Identifier" ? { local: value.name }
                : { range: { start: node.start, end: node.end, prefix: "" } });
        }
    }
    // Any other use of module.exports or a free `exports` (Object.assign, computed
    // keys, writes inside functions) means the list above may be incomplete.
    traverse(ast, {
        MemberExpression(path: any) {
            if (isModuleExports(path.node) && !consumed.has(path.node.start)) opaque = true;
        },
        Identifier(path: any) {
            if (path.node.name !== "exports" || path.scope.getBinding("exports") || consumed.has(path.node.start)) return;
            const parent = path.parentPath;
            if (parent.isMemberExpression() && parent.node.property === path.node && !parent.node.computed) return;
            if ((parent.isObjectProperty() || parent.isObjectMethod()) && parent.node.key === path.node && !parent.node.computed) return;
            opaque = true;
        }
    } as any);

    return (imported) => {
        if (imported === "*" || imported === "default") return "unknown";
        const entry = exported.get(imported);
        if (!entry) return complete && !opaque ? "absent" : "unknown";
        const range = entry.local ? declarations.get(entry.local) : entry.range;
        return range ? { local: entry.local ?? imported, text: slice(code, range) } : { local: entry.local ?? imported };
    };
}
