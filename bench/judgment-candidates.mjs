/**
 * List the workflow verdicts the line rule cannot settle alone, for manual judgment: a defect
 * claimed on a planted-bug file outside its acceptable range, or any defect on a control.
 *
 *   node bench/judgment-candidates.mjs results-final-claude-resumed.json [...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const file of process.argv.slice(2)) {
    const data = JSON.parse(await fs.readFile(path.join(here, 'results', file), 'utf8'));
    for (const run of data.runs) {
        for (const target of data.config.targets) {
            const v = (run.verdicts ?? []).find(x => x.file === target.file);
            if (!v?.defect) continue;
            const inRange = target.kind === 'buggy' && typeof v.line === 'number' &&
                target.acceptableRanges.some(([s, e]) => v.line >= s && v.line <= e);
            if (inRange) continue;
            console.log(JSON.stringify({ key: `${data.config.provider}/${run.id}/${target.file}`, responseHash: run.responseHash,
                kind: target.kind, planted: target.summary ?? null, line: v.line, reason: v.reason }));
        }
    }
}
