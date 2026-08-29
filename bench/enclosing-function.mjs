/**
 * Finds the function a planted defect sits inside, for the answer key.
 *
 * Grading a prediction by "within three lines of the planted line" measures the
 * wrong thing in both directions. On `lib/retry.js`, thirteen lines long, a
 * tolerance of three accepts most of the file, so a prediction lands inside it
 * by luck. On a defect with two defensible sites, the acquisition of a resource
 * and the teardown that fails to release it, three lines is too strict and a
 * correct answer scores as a miss.
 *
 * Naming the enclosing function asks the question the caller actually has: did
 * it send me to the right place to look? The exact-line count is reported
 * alongside it, and that is the strict measure.
 */
import { parse } from "@babel/parser";

const FUNCTION_TYPES = new Set([
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ClassMethod",
    "ClassPrivateMethod",
    "ObjectMethod"
]);

const PLUGINS = ["jsx", "typescript", "decorators-legacy", "decoratorAutoAccessors"];

/**
 * The innermost function containing `line`, as a [start, end] pair.
 *
 * Returns undefined for a defect at module level, where there is no function to
 * name and the caller should fall back to a line tolerance.
 */
export function enclosingFunction(code, line) {
    let ast;
    try {
        ast = parse(code, { sourceType: "unambiguous", errorRecovery: true, plugins: PLUGINS });
    } catch {
        return undefined;
    }

    let best;

    // A plain walk rather than @babel/traverse: this needs one predicate and no
    // scope information, and traverse's ESM interop is more trouble than the
    // twelve lines it would save.
    const visit = (node) => {
        if (node === null || typeof node !== "object") {
            return;
        }
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        const { loc, type } = node;
        if (typeof type === "string" && FUNCTION_TYPES.has(type) && loc) {
            const spans = loc.start.line <= line && line <= loc.end.line;
            // A single-line arrow is not a place to look. `filter((s) => !s.active)`
            // would name one line, which is stricter than the tolerance it
            // replaces; the method around it is the unit a reader opens.
            const multiline = loc.end.line > loc.start.line;
            const tighter = best === undefined || loc.end.line - loc.start.line < best[1] - best[0];
            if (spans && multiline && tighter) {
                best = [loc.start.line, loc.end.line];
            }
        }
        for (const key of Object.keys(node)) {
            if (key !== "loc" && key !== "leadingComments" && key !== "trailingComments") {
                visit(node[key]);
            }
        }
    };

    visit(ast.program);
    return best;
}

/** Enclosing ranges for every line the answer key accepts, deduplicated. */
export function acceptableRanges(code, lines) {
    const ranges = [];
    for (const line of lines) {
        const range = enclosingFunction(code, line);
        if (range && !ranges.some(([s, e]) => s === range[0] && e === range[1])) {
            ranges.push(range);
        }
    }
    return ranges;
}
