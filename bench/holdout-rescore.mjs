/**
 * Re-score saved engine results against the current held-out answer key, from each file's
 * recorded top finding. Used after poller.ts moved from controls to discovered defects.
 *
 *   node bench/holdout-rescore.mjs results-holdout-*.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(here, 'manifest.json'), 'utf8')).holdout;
const bugs = new Map(manifest.bugs.map(bug => [`corpus/${bug.file}`, bug]));
const controls = new Set(manifest.controls.map(file => `corpus/${file}`));

for (const file of process.argv.slice(2)) {
    const data = JSON.parse(await fs.readFile(path.resolve(here, 'results', file), 'utf8'));
    const cells = data.runs.map(run => {
        let detected = 0, falseAlarms = 0, unavailable = 0;
        const notes = [];
        for (const row of run.rows) {
            const top = row.top;
            if (!top || top.pattern === 'unknown') { unavailable++; continue; }
            const actionable = top.score >= 0.7;
            const bug = bugs.get(row.file);
            if (bug) {
                if (actionable && top.line !== undefined && bug.acceptableRanges.some(([s, e]) => top.line >= s && top.line <= e)) detected++;
                else notes.push(`miss ${row.file.split('/').pop()} ${top.score}`);
            } else if (controls.has(row.file) && actionable) {
                falseAlarms++;
                notes.push(`FA ${row.file.split('/').pop()} ${top.score}`);
            }
        }
        return `${detected}/${bugs.size} ${falseAlarms}/${controls.size}FA${unavailable ? ` ${unavailable}unavail` : ''} ${run.usage.total}tok${notes.length ? ` (${notes.join('; ')})` : ''}`;
    });
    console.log(file.padEnd(38), cells.join(' | '));
}
