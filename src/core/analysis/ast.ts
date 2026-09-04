import { FileMetrics } from "../types";

/** The parser's own options type, reached without a static ESM import. */
type ParseOptions = Parameters<Awaited<ReturnType<typeof loadBabel>>["parse"]>[1];

/**
 * @babel/parser and @babel/traverse are ESM-only from v8, and both the
 * extension host and the MCP server load us as CommonJS — so they have to come
 * in through a real dynamic import rather than a top-level `require`.
 *
 * Exported because `callees.ts` needs the same pair, and the import has to be
 * dynamic there for the same reason.
 */
export async function loadBabel() {
    const [parser, traverseModule] = await Promise.all([
        import("@babel/parser"),
        import("@babel/traverse")
    ]);
    const traverse =
        (traverseModule as unknown as { default?: unknown }).default ?? traverseModule;
    return { parse: parser.parse, traverse: traverse as typeof traverseModule.default };
}

/**
 * One parser configuration for every caller, so a file that `collectMetrics`
 * can read is also one `collectCalleeContext` can read.
 *
 * `decorators-legacy` matches what Angular, Nest, TypeORM and MobX emit today
 * under `experimentalDecorators`. Without it a decorated class is a parse
 * error, which zeroes the file's metrics and sinks it to the bottom of the
 * scan_project ranking -- so the tool recommended reading a Nest project's
 * controllers and services last. `decoratorAutoAccessors` covers the
 * `accessor` keyword, which neither decorator plugin handles on its own.
 */
export const PARSE_OPTIONS: ParseOptions = {
    sourceType: "unambiguous",
    errorRecovery: true,
    plugins: ["jsx", "typescript", "decorators-legacy", "decoratorAutoAccessors"]
};

export function emptyMetrics(): FileMetrics {
    return {
        functions: 0,
        longFunctions: 0,
        branches: 0,
        asyncCalls: 0,
        nestedLoops: 0,
        mutations: 0,
        tryCatch: 0,
        cyclomatic: 1,
        lines: 0
    };
}

function countLines(code: string): number {
    let lines = 1;
    for (let i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) === 10) lines++;
    }
    return lines;
}

/** Collect static complexity metrics from a JavaScript/TypeScript source file. */
export async function collectMetrics(code: string): Promise<FileMetrics> {
    const { parse, traverse } = await loadBabel();

    const ast = parse(code, PARSE_OPTIONS);

    const metrics = emptyMetrics();
    metrics.lines = countLines(code);

    traverse(ast, {
        // Class and object methods have to be listed explicitly: Babel does not
        // treat them as FunctionExpression. Leaving them out meant `functions`
        // and `longFunctions` were blind to every method in a class-based
        // codebase, and `longFunctions` carries 0.15 of the risk weight. Across
        // the 40-file benchmark corpus it had never once fired.
        "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ClassPrivateMethod|ObjectMethod"(
            path: any
        ) {
            metrics.functions++;
            const body = path.node.body;
            const statements = body && body.type === "BlockStatement" ? body.body.length : 0;
            if (statements > 20) {
                metrics.longFunctions++;
            }
        },
        "IfStatement|ConditionalExpression|SwitchCase"() {
            metrics.branches++;
            metrics.cyclomatic++;
        },
        "ForStatement|ForOfStatement|ForInStatement|WhileStatement"(path: any) {
            metrics.cyclomatic++;
            if (
                path.findParent(
                    (parent: any) =>
                        parent.isForStatement() ||
                        parent.isForOfStatement() ||
                        parent.isForInStatement() ||
                        parent.isWhileStatement()
                )
            ) {
                metrics.nestedLoops++;
            }
        },
        CallExpression(path: any) {
            const callee = path.node.callee;
            if (
                callee.type === "Identifier" &&
                ["setTimeout", "setInterval", "setImmediate"].includes(callee.name)
            ) {
                metrics.asyncCalls++;
            }
        },
        AwaitExpression() {
            metrics.asyncCalls++;
        },
        "UpdateExpression|AssignmentExpression"() {
            metrics.mutations++;
        },
        TryStatement() {
            metrics.tryCatch++;
        }
    } as any);

    return metrics;
}
