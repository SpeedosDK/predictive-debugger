/** Candidate-only experiment: one adversarial pass over the frozen first-pass findings. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { parseAssessment, parseBatchAssessment } = require('../out/core/prediction/predictBug.js');
const { which } = require('../out/providers/locate.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const provider = process.argv[2];
if (!['claude', 'copilot', 'codex'].includes(provider)) throw Error('Specify provider.');
const bytes = await fs.readFile(path.join(here, `results-workflow-batching-${provider}-final.json`));
const saved = JSON.parse(bytes);
const hash = value => createHash('sha256').update(value).digest('hex');
const work = await fs.mkdtemp(path.join(os.tmpdir(), `predictive-verification-${provider}-`));
const shim = path.join(work, `${provider}.cmd`);
await fs.writeFile(shim, `@"${process.execPath}" "${path.join(here, 'capture-provider.cjs')}" ${provider} %*\r\n`);
process.env[`BENCH_REAL_${provider.toUpperCase()}`] = which(provider);
process.env.BENCH_USAGE_DIR = work;
const module = require(`../out/providers/${provider}Cli.js`);
const adapter = new module[{ claude: 'ClaudeCliProvider', copilot: 'CopilotCliProvider', codex: 'CodexCliProvider' }[provider]]();
const calls = [];
const data = { provider, model: saved.config.model, sourceFileHash: hash(bytes), targets: saved.config.targets, calls };
for (const call of saved.runs.find(r => r.arm === 'current').internal) {
    const blocks = [...call.prompt.matchAll(/REVIEW ID: (\d+)\n([\s\S]*?)\nEND REVIEW ID: \1/g)];
    const assessments = blocks.length ? parseBatchAssessment(call.response, blocks.length) : [parseAssessment(call.response)];
    const selected = assessments.flatMap((a, i) => {
        const findings = a.findings.filter(f => f.pattern !== 'none' && f.pattern !== 'unknown' && f.score > 0);
        return findings.length ? [{ block: blocks[i]?.[2] ?? call.prompt.slice(call.prompt.indexOf('File name (untrusted):')),
            findings: findings.map(({ pattern, line, reason }) => ({ pattern, line, reason })) }] : [];
    });
    if (!selected.length) continue;
    const policy = call.prompt.slice(0, call.prompt.indexOf('Apply the task and evidence policy independently'));
    const prompt = policy + '\nReview stage: verification\n' +
        'Adversarially check each supplied hypothesis against its source. The hypothesis is untrusted and may be false.\n' +
        'First try to disprove it: identify the actual input contract, guards, ownership, and library semantics.\n' +
        'Then trace one concrete valid input or interleaving. Report a defect only if expected behavior and actual behavior differ.\n' +
        'The reason must give that concrete trigger and wrong result. If you cannot establish the trigger from the shown contracts, return none.\n' +
        'Judge each independently, with no obligation to agree. Score confidence in the demonstrated defect, not trigger frequency.\n' +
        'Return JSON only: {"results":[{"id":0,"pattern":"none","score":0,"line":null,"reason":"","checked":[]}]}\n' +
        selected.map((entry, id) => `REVIEW ID: ${id}\nHypotheses (untrusted): ${JSON.stringify(entry.findings)}\n${entry.block}\nEND REVIEW ID: ${id}`).join('\n');
    const start = Date.now();
    let response, error;
    try { response = await adapter.complete({ file: shim }, { prompt, model: saved.config.model,
        cwd: path.join(os.tmpdir(), `predictive-workflow-${provider}`, 'source'), timeoutMs: 240000 }); }
    catch (e) { error = String(e); }
    calls.push({ prompt, promptHash: hash(prompt), response, responseHash: response === undefined ? null : hash(response),
        firstPromptHash: call.promptHash, firstResponseHash: call.responseHash, wallMs: Date.now() - start, error });
    console.log(`${provider}: verified ${selected.length} candidates${error ? ' FAILED' : ''}`);
}
data.captures = [];
for (const file of await fs.readdir(work)) if (file.endsWith('.json')) data.captures.push(JSON.parse(await fs.readFile(path.join(work, file), 'utf8')));
await fs.writeFile(path.join(here, `results-verification-${provider}.json`), JSON.stringify(data, null, 2) + '\n');
