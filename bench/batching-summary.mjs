import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { copilotUsage, parseBatch } from './provider-batching.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

export function summarizeBatching(data, judgments, filename) {
    if (data.status !== 'complete') throw Error(`Incomplete experiment: ${filename}`);
    const row = { file: filename, provider: data.config.provider, size: data.config.size,
        isolated: data.config.isolated ?? false, cases: 0, bugs: 0, detected: 0, otherVerified: 0,
        controls: 0, falseAlarms: 0, unavailable: 0, calls: data.calls.length,
        input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0,
        maxTaskPromptTokens: 0, wallMs: 0 };
    const seen = new Set();
    for (const call of data.calls) {
        if (hash(call.prompt) !== call.promptHash || hash(call.raw) !== call.responseHash) throw Error('Stale call hashes.');
        if (call.error || call.code !== 0 || !Number.isInteger(call.trial) || call.trial < 1 || call.trial > data.config.trials) {
            throw Error('Failed call or invalid trial.');
        }
        const assessments = parseBatch(call.raw, call.files.length);
        for (const [index, file] of call.files.entries()) {
            const key = `${call.trial}/${file}`;
            if (seen.has(key)) throw Error('Duplicate file/trial.');
            seen.add(key);
            const target = data.config.targets.find(t => t.file === file);
            if (!target) throw Error('Unknown target.');
            row.cases++;
            if (target.kind === 'buggy') row.bugs++; else row.controls++;
            const verdict = assessments[index].findings[0];
            if (verdict.pattern === 'unknown') { row.unavailable++; continue; }
            if (verdict.pattern === 'none' || verdict.score < 0.7) continue;
            const judgment = judgments[`${filename}/${call.id}/${file}`];
            if (!judgment || judgment.sourceHash !== target.sourceHash || judgment.promptHash !== call.promptHash ||
                judgment.responseHash !== call.responseHash || typeof judgment.matchesDefect !== 'boolean') {
                throw Error(`Missing/stale judgment: ${filename}/${call.id}/${file}`);
            }
            if (target.kind === 'buggy' && judgment.matchesDefect) row.detected++;
            if (target.kind === 'buggy' && !judgment.matchesDefect && judgment.validDefect === true) row.otherVerified++;
            if (target.kind === 'clean') row.falseAlarms++;
        }
        const tokens = data.config.provider === 'copilot' ? copilotUsage(call.report) : call.tokens;
        if (!tokens || !Number.isFinite(tokens.total)) throw Error('Missing token accounting.');
        // Codex includes cached input in input_tokens. Cache writes are not split out.
        row.input += tokens.input - (data.config.provider === 'codex' ? tokens.cacheRead : 0);
        row.cacheRead += tokens.cacheRead;
        row.cacheWrite += tokens.cacheWrite ?? 0;
        row.output += tokens.output;
        row.total += tokens.total;
        row.maxTaskPromptTokens = Math.max(row.maxTaskPromptTokens, call.estimatedPromptTokens);
        row.wallMs += call.wallMs;
    }
    if (seen.size !== data.config.targets.length * data.config.trials) throw Error('Missing file/trial.');
    if (row.input + row.cacheRead + row.cacheWrite + row.output !== row.total) throw Error('Token categories do not reconcile.');
    return row;
}

async function main() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const judgments = JSON.parse(await fs.readFile(path.join(here, 'judgments-batching.json'), 'utf8'));
    const files = (await fs.readdir(here)).filter(f => /^results-batching-.*\.json$/.test(f));
    const rows = [];
    for (const file of files) {
        const bytes = await fs.readFile(path.join(here, file));
        const data = JSON.parse(bytes);
        if (data.status !== 'complete') { rows.push({ file, status: data.status }); continue; }
        rows.push({ ...summarizeBatching(data, judgments, file), sha256: hash(bytes) });
    }
    console.log(JSON.stringify(rows, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
