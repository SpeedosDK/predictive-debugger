/**
 * For each engine run, compare every re-checked file's group verdict with the single-file
 * verdict that replaced it. Reads the raw calls saved by engine-accuracy.mjs.
 *
 *   node bench/recheck-effect.mjs results-engine-*-all-racecheck.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseAssessment, parseBatchAssessment } = require('../out/core/prediction/predictBug.js');
const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of process.argv.slice(2)) {
    const data = JSON.parse(await fs.readFile(path.resolve(here, 'results', file), 'utf8'));
    const kinds = new Map();
    console.log(`## ${file}`);
    for (const run of data.runs) {
        for (const row of run.rows) kinds.set(row.file, row.kind);
        const name = prompt => [...prompt.matchAll(/^File name \(untrusted\): (".*")$/gm)]
            .map(m => JSON.parse(m[1]).split('\\').join('/'))
            .map(p => [...kinds.keys()].find(t => p.endsWith('/' + t)));
        const grouped = new Map(), alone = new Map();
        for (const call of run.raw) {
            const files = name(call.prompt);
            if (files.length > 1) parseBatchAssessment(call.response, files.length).forEach((a, i) => grouped.set(files[i], a.findings[0]));
            else alone.set(files[0], parseAssessment(call.response).findings[0]);
        }
        for (const [target, solo] of alone) {
            const before = grouped.get(target);
            if (!before) continue;
            const fmt = f => `${f.pattern} ${f.score}`;
            console.log(`  trial ${run.trial} ${kinds.get(target).padEnd(5)} ${target.split('/').pop().padEnd(26)} group: ${fmt(before).padEnd(22)} alone: ${fmt(solo)}`);
        }
    }
}
