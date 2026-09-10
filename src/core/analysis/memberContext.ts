interface SourceRange {
    start: number;
    end: number;
    prefix: string;
}

function memberKey(entry: any): string | undefined {
    if (entry.computed) return undefined;
    if (entry.key?.type === "PrivateName") return `#${entry.key.id.name}`;
    return entry.key?.name ?? entry.key?.value;
}

function referencedMember(value: any, ownerName: string): string | undefined {
    if (value.type !== "MemberExpression" && value.type !== "OptionalMemberExpression") return undefined;
    const belongsToOwner = value.object.type === "ThisExpression" ||
        value.object.type === "Identifier" && value.object.name === ownerName;
    if (!belongsToOwner) return undefined;
    if (value.computed) return value.property.type === "StringLiteral" ? value.property.value : undefined;
    return value.property.type === "PrivateName" ? `#${value.property.id.name}` : value.property.name;
}

function isStateMember(entry: any): boolean {
    const method = entry.type === "ObjectMethod" || entry.type === "ClassMethod" || entry.type === "ClassPrivateMethod";
    return !method || entry.kind === "get" || entry.kind === "set" || entry.kind === "constructor";
}

/** Select whole members without changing their original declaration order. */
export function selectMemberContext(
    code: string,
    node: any,
    member: string,
    range: SourceRange,
    budget: number,
    ownerName: string
): { text: string; excerpted?: boolean } {
    const full = range.prefix + code.slice(range.start, range.end);
    if (full.length <= budget) return { text: full };

    const object = node.type === "ObjectExpression";
    const members: any[] = object ? node.properties : node.body.body;
    const target = members.find(entry => memberKey(entry) === member && (object || entry.static));
    if (!target) return { text: full };

    const definitions = new Map<string, any[]>();
    for (const entry of members) {
        const name = memberKey(entry);
        if (name === undefined) continue;
        const previous = definitions.get(name) ?? [];
        previous.push(entry);
        definitions.set(name, previous);
    }
    const overwritten = [...definitions.values()].some(entries => entries.length > 1 &&
        !(entries.length === 2 && new Set(entries.map(entry => entry.kind)).size === 2 &&
            entries.every(entry => entry.kind === "get" || entry.kind === "set")));

    // Dynamic keys, spreads, inheritance and decorators can change which member
    // actually runs. Keep the original declaration rather than construct a slice.
    if (overwritten || members.length > 512 || node.superClass || node.decorators?.length || members.some(entry =>
        entry.computed || entry.type === "SpreadElement" || entry.decorators?.length)) return { text: full };

    const container = object ? node : node.body;
    const header = range.prefix + code.slice(range.start, container.start + 1);
    const footer = code.slice(container.end - 1, range.end);
    const marker = "/* … omitted members/state … */";
    const start = (entry: any) => Math.max(container.start + 1,
        entry.leadingComments?.[0]?.start ?? entry.start);
    const source = (entry: any) => code.slice(start(entry), entry.end) + (object ? "," : "");

    const chosen = new Set<any>();
    const render = () => {
        const parts = [header];
        let omitted = false;
        for (const entry of members) {
            if (chosen.has(entry)) {
                if (omitted) parts.push(marker);
                parts.push(source(entry));
                omitted = false;
            } else omitted = true;
        }
        if (omitted) parts.push(marker);
        parts.push(footer);
        return parts.join("\n");
    };
    const include = (entry: any) => {
        chosen.add(entry);
        if (render().length <= budget) return true;
        chosen.delete(entry);
        return false;
    };

    if (!include(target)) {
        // Even an oversized method should spend its prefix budget on the called
        // body, not on an unrelated member that happens to precede it.
        const opening = `${header}\n${marker}\n`;
        const closing = `\n${marker}\n${footer}`;
        const available = budget - opening.length - closing.length;
        if (available < 120) return { text: full };
        const cut = source(target).slice(0, available);
        const lastBreak = cut.lastIndexOf("\n");
        return { text: opening + (lastBreak < 0 ? cut : cut.slice(0, lastBreak)) + closing, excerpted: true };
    }

    // References only set priority. They are not a proof that other members
    // cannot mutate this state; remaining members still compete for space.
    const referenced = new Set<any>([target]);
    for (const entry of referenced) {
        const names = new Set<string>();
        const visit = (value: any): void => {
            if (!value || typeof value !== "object") return;
            const reference = referencedMember(value, ownerName);
            if (reference !== undefined) names.add(reference);
            for (const [name, child] of Object.entries(value)) {
                if (["loc", "leadingComments", "trailingComments", "innerComments", "extra"].includes(name)) continue;
                if (Array.isArray(child)) child.forEach(visit);
                else if (child && typeof child === "object") visit(child);
            }
        };
        visit(entry);
        for (const sibling of members) {
            if (names.has(memberKey(sibling)!) && (object || sibling.static) && !referenced.has(sibling)) {
                referenced.add(sibling);
            }
        }
    }
    for (const entry of referenced) if (entry !== target) include(entry);
    for (const entry of members) {
        if (!chosen.has(entry) && isStateMember(entry)) include(entry);
    }
    for (const entry of members) if (!chosen.has(entry)) include(entry);
    return { text: render(), excerpted: true };
}
