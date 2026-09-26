import { loadBabel, PARSE_OPTIONS } from "./ast";

const WRITE_METHOD = /^(set|save|update|write|put|insert|upsert|store|persist|increment|decrement|apply|commit)/i;

/**
 * Whether an async function awaits a read into a local and later awaits a
 * write-like method call: the shape of a lost update when the function runs
 * concurrently. A hint for where a grouped review is least reliable, not a
 * defect verdict — serialized code has the same shape.
 */
export async function hasReadAwaitWrite(code: string): Promise<boolean> {
    const { parse, traverse } = await loadBabel();
    let ast;
    try {
        ast = parse(code, PARSE_OPTIONS);
    } catch {
        return false;
    }
    let found = false;
    traverse(ast, {
        "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ClassPrivateMethod|ObjectMethod"(fn: any) {
            if (found || !fn.node.async) return;
            let firstRead = Infinity;
            fn.traverse({
                // Nested functions have their own invocation and are visited on their own.
                Function(inner: any) { inner.skip(); },
                VariableDeclarator(decl: any) {
                    const init = decl.get("init");
                    if (!init.node) return;
                    let awaited = init.isAwaitExpression();
                    init.traverse({
                        Function(inner: any) { inner.skip(); },
                        AwaitExpression() { awaited = true; }
                    });
                    if (awaited) firstRead = Math.min(firstRead, decl.node.end);
                },
                AwaitExpression(await_: any) {
                    const call = await_.node.argument;
                    if (call?.type === "CallExpression" && call.callee.type === "MemberExpression" &&
                        call.callee.property.type === "Identifier" && WRITE_METHOD.test(call.callee.property.name) &&
                        await_.node.start > firstRead) {
                        found = true;
                    }
                }
            });
        }
    } as any);
    return found;
}
