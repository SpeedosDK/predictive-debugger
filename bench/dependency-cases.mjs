import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeDependencyCases(root) {
    const sources = {
        'entry.ts': 'import { value } from "./barrel";\nimport type { Shape } from "./types";\nexport const result: Shape = { value };\nexport function lazy() { return import("./lazy"); }\nexport function load(name: string) { return import("./" + name); }\n',
        'barrel.ts': 'export { value } from "./leaf";\nexport * from "./types";\n',
        'leaf.ts': 'export const value = 1;\n',
        'types.ts': 'export interface Shape { value: number }\n',
        'lazy.ts': 'import { result } from "./entry";\nexport function read() { return result; }\n',
        'consumer.ts': 'import { result } from "./entry";\nexport function display() { return result.value; }\n',
        'entry.test.ts': 'import { display } from "./consumer";\nexport const observed = display();\n',
        'unrelated.test.ts': 'export const unrelated = true;\n'
    };
    for (const [name, source] of Object.entries(sources)) {
        const file = path.join(root, 'src/dependencies', name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, source);
    }
    return {
        fileCount: Object.keys(sources).length,
        note: 'Static file relationships only. Test filenames indicate connections, not execution coverage.',
        edges: [
            ['entry.ts', 'barrel.ts', 1, 'import', false],
            ['entry.ts', 'types.ts', 2, 'import', true],
            ['entry.ts', 'lazy.ts', 4, 'dynamic-import', false],
            ['barrel.ts', 'leaf.ts', 1, 're-export', false],
            ['barrel.ts', 'types.ts', 2, 're-export', false],
            ['lazy.ts', 'entry.ts', 1, 'import', false],
            ['consumer.ts', 'entry.ts', 1, 'import', false],
            ['entry.test.ts', 'consumer.ts', 1, 'import', false]
        ].map(([from, to, line, kind, typeOnly]) => ({ from: `src/dependencies/${from}`, to: `src/dependencies/${to}`,
            line, kind, ...(typeOnly ? { typeOnly } : {}) })),
        queries: [
            { file: 'src/dependencies/entry.ts', depth: 2,
                dependencies: ['barrel.ts', 'types.ts', 'lazy.ts', 'leaf.ts'],
                dependents: ['consumer.ts', 'lazy.ts', 'entry.test.ts'], unresolvedLines: [5] },
            { file: 'src/dependencies/leaf.ts', depth: 3,
                dependencies: [], dependents: ['barrel.ts', 'entry.ts', 'consumer.ts', 'lazy.ts'], unresolvedLines: [] }
        ]
    };
}
