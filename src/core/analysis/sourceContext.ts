import { loadBabel, PARSE_OPTIONS } from "./ast";

export interface SourceContext {
    text: string;
    ranges: Array<[number, number]>;
    truncated?: string;
}

/** Keep original line numbers and whole declarations within one model call. */
export async function selectSourceContext(code: string, budget: number): Promise<SourceContext> {
    const lines = code.split("\n");
    const width = String(lines.length).length;
    const numbered = lines.map((line, i) => `${String(i + 1).padStart(width)}| ${line}`);
    const full = numbered.join("\n");
    if (full.length <= budget) {
        return { text: full, ranges: [[1, lines.length]] };
    }

    const selected = new Set<number>();
    const marker = "/* omitted source */";
    let spent = 0;
    const include = (start: number, end: number): boolean => {
        const pending: number[] = [];
        for (let i = start; i <= end; i++) {
            if (!selected.has(i)) pending.push(i);
        }
        // Reserve a marker per declaration, an upper bound on actual gaps.
        const cost = pending.reduce((sum, i) => sum + numbered[i - 1].length + 1, 0) + marker.length + 1;
        if (spent + cost > budget) return false;
        pending.forEach(i => selected.add(i));
        spent += cost;
        return true;
    };

    try {
        const { parse } = await loadBabel();
        const ast = parse(code, PARSE_OPTIONS);
        const declarations: Array<[number, number]> = [];
        for (const node of ast.program.body) {
            if (!node.loc) continue;
            const start = node.leadingComments?.[0]?.loc?.start.line ?? node.loc.start.line;
            const range: [number, number] = [start, node.loc.end.line];
            if (node.type === "ImportDeclaration") {
                include(...range);
                continue;
            }
            const declaration = node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"
                ? node.declaration : node;
            if (declaration?.type === "ClassDeclaration" && declaration.body.loc &&
                numbered.slice(start - 1, node.loc.end.line).join("\n").length > budget / 2) {
                include(start, declaration.body.loc.start.line);
                include(declaration.body.loc.end.line, declaration.body.loc.end.line);
                for (const member of declaration.body.body) {
                    if (!member.loc) continue;
                    const memberRange: [number, number] = [
                        member.leadingComments?.[0]?.loc?.start.line ?? member.loc.start.line,
                        member.loc.end.line
                    ];
                    if (member.type === "ClassMethod" || member.type === "ClassPrivateMethod") {
                        declarations.push(memberRange);
                    } else include(...memberRange);
                }
            } else declarations.push(range);
        }
        // Alternate ends so an early large declaration cannot hide every later function.
        for (let left = 0, right = declarations.length - 1; left <= right; left++, right--) {
            include(...declarations[left]);
            if (left !== right) include(...declarations[right]);
        }
    } catch {
        // Unparseable files still get a bounded prefix; no syntax is invented.
    }

    if (selected.size === 0) {
        for (let i = 1; i <= lines.length; i++) {
            if (!include(i, i)) break;
        }
    }

    const ranges: Array<[number, number]> = [];
    for (const line of [...selected].sort((a, b) => a - b)) {
        const last = ranges.at(-1);
        if (last && last[1] + 1 === line) last[1] = line;
        else ranges.push([line, line]);
    }
    const parts: string[] = [];
    let previous = 0;
    for (const [start, end] of ranges) {
        if (start > previous + 1) parts.push(marker);
        parts.push(numbered.slice(start - 1, end).join("\n"));
        previous = end;
    }
    if (previous < lines.length) parts.push(marker);
    return {
        text: parts.join("\n"),
        ranges,
        truncated: `verdict covers ${selected.size} of ${lines.length} lines in selected excerpts; omitted code was not reviewed`
    };
}
