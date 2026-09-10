import fs from "node:fs/promises";
import path from "node:path";

/** Additional pairs in the existing corpus; historical targets stay unchanged. */
export async function writeAccuracyCases(root) {
    const audit = `audit(values: string[]) {\n${Array.from({ length: 90 }, (_, i) =>
        `        if (values[${i}]) console.log("audit ${i}", values[${i}]);`).join('\n')}\n    }`;
    const sources = {
        "src/accuracy/contracts.ts": "export interface Row { discount?: { amount: number } }\n",
        "src/accuracy/barrel.ts": 'export type { Row } from "./contracts";\n',
        "src/accuracy/discount.ts": 'import type { Row } from "./barrel";\nexport function discount(row: Row) {\n    return row.discount.amount;\n}\n',
        "src/accuracy/discount.fixed.ts": 'import type { Row } from "./barrel";\nexport function discount(row: Row) {\n    return row.discount?.amount ?? 0;\n}\n',
        "src/accuracy/normalizer.ts": 'export const dates = { normalize(value: Date | string) { return value instanceof Date ? value : new Date(value); } };\n',
        "src/accuracy/normalizer.barrel.ts": 'export { dates } from "./normalizer";\n',
        "src/accuracy/billing.ts": 'import { dates } from "./normalizer.barrel";\nexport function bill(value: Date | string) {\n    return dates.normalize(value).getTime();\n}\n',
        "src/accuracy/billing.fixed.ts": 'import { dates } from "./normalizer.barrel";\nexport function bill(value: Date | string) {\n    return dates.normalize(dates.normalize(value)).getTime();\n}\n',
        "src/accuracy/large-directory.ts": `export const directory = {\n    ${audit},\n    rows: new Map<string, { name: string }>(),\n    read(id: string) { return this.rows.get(id); },\n    get(id: string) { return this.read(id); }\n};\n`,
        "src/accuracy/late-member.ts": 'import { directory } from "./large-directory";\nexport function displayName(id: string) {\n    return directory.get(id).name.toUpperCase();\n}\n',
        "src/accuracy/late-member.fixed.ts": 'import { directory } from "./large-directory";\nexport function displayName(id: string) {\n    return directory.get(id)?.name.toUpperCase() ?? "Unknown";\n}\n',
        "src/accuracy/large-normalizer.ts": `export const dates = {\n    ${audit},\n    normalize(value: Date | string) { return value instanceof Date ? value : new Date(value); }\n};\n`,
        "src/accuracy/late-normalizer.ts": 'import { dates } from "./large-normalizer";\nexport function bill(value: Date | string) {\n    return dates.normalize(dates.normalize(value)).getTime();\n}\n',
        "src/accuracy/wildcard.barrel.ts": 'export * from "./contracts";\n',
        "src/accuracy/wildcard-discount.ts": 'import type { Row } from "./wildcard.barrel";\nexport function discount(row: Row) {\n    return row.discount.amount;\n}\n',
        "src/accuracy/wildcard-discount.fixed.ts": 'import type { Row } from "./wildcard.barrel";\nexport function discount(row: Row) {\n    return row.discount?.amount ?? 0;\n}\n',
        "src/accuracy/coupon-source.ts": 'export function resolveCoupon(id: string): { amount: number } | undefined {\n    return undefined;\n}\n',
        "src/accuracy/coupon.barrel.ts": 'import { resolveCoupon as lookup } from "./coupon-source";\nexport { lookup as couponFor };\n',
        "src/accuracy/forwarded-coupon.ts": 'import { couponFor } from "./coupon.barrel";\nexport function discount(id: string) {\n    return couponFor(id).amount;\n}\n',
        "src/accuracy/forwarded-coupon.fixed.ts": 'import { couponFor } from "./coupon.barrel";\nexport function discount(id: string) {\n    return couponFor(id)?.amount ?? 0;\n}\n',
        "src/accuracy/reading.ts": 'export class Reading {\n    value: string;\n    constructor(value: number) { this.value = String(value); }\n}\n',
        "src/accuracy/constructed-reading.ts": 'import { Reading } from "./reading";\nexport function display() {\n    return new Reading(7).value.toFixed(2);\n}\n',
        "src/accuracy/constructed-reading.fixed.ts": 'import { Reading } from "./reading";\nexport function display() {\n    return Number(new Reading(7).value).toFixed(2);\n}\n'
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
            summary: "Row permits an absent discount, which is dereferenced without a guard." },
            { file: "src/accuracy/late-member.ts", pattern: "null-reference", line: 3,
                acceptableLines: [3], acceptableRanges: [[2, 4]],
                summary: "The directory Map starts empty; get returns undefined for a missing id, then displayName dereferences name." },
            { file: "src/accuracy/wildcard-discount.ts", pattern: "null-reference", line: 3,
                acceptableLines: [3], acceptableRanges: [[2, 4]],
                summary: "The wildcard-exported Row contract permits an absent discount, dereferenced without a guard." },
            { file: "src/accuracy/forwarded-coupon.ts", pattern: "null-reference", line: 3,
                acceptableLines: [3], acceptableRanges: [[2, 4]],
                summary: "couponFor forwards resolveCoupon, which returns undefined; discount dereferences amount." },
            { file: "src/accuracy/constructed-reading.ts", pattern: "other", line: 3,
                acceptableLines: [3], acceptableRanges: [[2, 4]],
                summary: "Reading converts its input to a string; display calls the numeric toFixed method on that string." }],
        controls: ["src/accuracy/discount.fixed.ts", "src/accuracy/billing.ts", "src/accuracy/billing.fixed.ts",
            "src/accuracy/late-member.fixed.ts", "src/accuracy/late-normalizer.ts",
            "src/accuracy/wildcard-discount.fixed.ts", "src/accuracy/forwarded-coupon.fixed.ts",
            "src/accuracy/constructed-reading.fixed.ts"]
    };
}
