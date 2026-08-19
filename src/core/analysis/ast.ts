import { FileMetrics } from "../types";

/**
 * @babel/parser and @babel/traverse are ESM-only from v8, and both the
 * extension host and the MCP server load us as CommonJS — so they have to come
 * in through a real dynamic import rather than a top-level `require`.
 */
async function loadBabel() {
    const [parser, traverseModule] = await Promise.all([
        import("@babel/parser"),
        import("@babel/traverse")
    ]);
    const traverse =
        (traverseModule as unknown as { default?: unknown }).default ?? traverseModule;
    return { parse: parser.parse, traverse: traverse as typeof traverseModule.default };
}

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

    const ast = parse(code, {
        sourceType: "unambiguous",
        errorRecovery: true,
        plugins: ["jsx", "typescript"]
    });

    const metrics = emptyMetrics();
    metrics.lines = countLines(code);

    traverse(ast, {
        "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(path: any) {
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
