/**
 * Make a stopped cli-workflows.mjs result resumable without hiding what failed: failed
 * sessions move to `failedRuns`, completed ones stay, and the configuration (hence its
 * hash) is unchanged, so cli-workflows.mjs runs only the missing sessions.
 *
 *   node bench/resume-workflow.mjs results-final-claude.json results-final-claude-resumed.json
 *   node bench/cli-workflows.mjs <same flags> --output=results-final-claude-resumed.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [from, to] = process.argv.slice(2);
if (!from || !to || from === to) throw Error('Usage: resume-workflow.mjs <stopped.json> <new.json>');
const data = JSON.parse(await fs.readFile(path.join(here, 'results', from), 'utf8'));
const failed = data.runs.filter(run => run.failed);
const resumed = { ...data, status: 'running', resumedFrom: from,
    runs: data.runs.filter(run => !run.failed), failedRuns: [...(data.failedRuns ?? []), ...failed] };
await fs.writeFile(path.join(here, 'results', to), JSON.stringify(resumed, null, 2) + '\n', { flag: 'wx' });
console.log(`${to}: kept ${resumed.runs.length} sessions, moved ${failed.length} failed to failedRuns (${failed.map(r => r.id).join(', ')}).`);
