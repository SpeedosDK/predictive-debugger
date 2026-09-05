import fs from "node:fs/promises";
import path from "node:path";

/** Additional pairs in the existing corpus; historical targets stay unchanged. */
export async function writeAccuracyCases(root) {
    const sources = {
        "src/accuracy/contracts.ts": "export interface Row { discount?: { amount: number } }\n",
        "src/accuracy/barrel.ts": 'export type { Row } from "./contracts";\n',
        "src/accuracy/discount.ts": 'import type { Row } from "./barrel";\nexport function discount(row: Row) {\n    return row.discount.amount;\n}\n',
        "src/accuracy/discount.fixed.ts": 'import type { Row } from "./barrel";\nexport function discount(row: Row) {\n    return row.discount?.amount ?? 0;\n}\n',
        "src/accuracy/normalizer.ts": 'export const dates = { normalize(value: Date | string) { return value instanceof Date ? value : new Date(value); } };\n',
        "src/accuracy/normalizer.barrel.ts": 'export { dates } from "./normalizer";\n',
        "src/accuracy/billing.ts": 'import { dates } from "./normalizer.barrel";\nexport function bill(value: Date | string) {\n    return dates.normalize(value).getTime();\n}\n',
        "src/accuracy/billing.fixed.ts": 'import { dates } from "./normalizer.barrel";\nexport function bill(value: Date | string) {\n    return dates.normalize(dates.normalize(value)).getTime();\n}\n'
    };
    for (const [name, source] of Object.entries(sources)) {
        const file = path.join(root, name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, source, "utf8");
    }
    return {
        fileCount: Object.keys(sources).length,
        note: "Development cases, not a held-out accuracy claim. Both billing variants are clean because normalization is idempotent.",
        bugs: [{ file: "src/accuracy/discount.ts", pattern: "null-reference", line: 3,
            acceptableLines: [3], acceptableRanges: [[2, 4]],
            summary: "Row permits an absent discount, which is dereferenced without a guard." }],
        controls: ["src/accuracy/discount.fixed.ts", "src/accuracy/billing.ts", "src/accuracy/billing.fixed.ts"]
    };
}
