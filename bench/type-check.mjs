/** Real stdio measurement on the existing corpus; no CLI provider is involved. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { encode } from 'gpt-tokenizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const hash = value => createHash('sha256').update(value).digest('hex');
const baselineBytes = await fs.readFile(path.join(here, 'results', 'results-cache-v083-isolated.json'));
const saved = JSON.parse(baselineBytes);
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'predictive-type-corpus-'));
const client = new Client({ name: 'type-check-benchmark', version: '1' });
try {
    for (const corpus of ['corpus', 'corpus-ts']) await fs.cp(path.join(here, corpus), path.join(stage, corpus), { recursive: true });
    for (const file of saved.config.corpus) {
        if (hash(await fs.readFile(path.join(stage, file.file))) !== file.hash) throw Error(`Source changed: ${file.file}`);
    }
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/mcp-server.js')], cwd: stage }));
    const calls = [];
    for (let start = 0; start < saved.config.targets.length; start += 20) {
        const targets = saved.config.targets.slice(start, start + 20);
        const args = { files: targets.map(t => path.join(stage, t.file)) };
        const began = Date.now();
        const result = await client.callTool({ name: 'check_types', arguments: args });
        if (result.isError) throw Error(JSON.stringify(result));
        const raw = result.content[0].text;
        const response = JSON.parse(raw);
        if (response.status !== 'checked' || response.skipped.length || response.truncated) throw Error(raw);
        calls.push({ files: targets.map(t => t.file), args, response, responseHash: hash(raw), raw,
            responseTokens: encode(raw).length, argumentTokens: encode(JSON.stringify(args)).length, wallMs: Date.now() - began });
    }
    const data = { createdAt: new Date().toISOString(), sourceRecordHash: hash(baselineBytes), corpus: saved.config.corpus,
        targets: saved.config.targets, bundle: hash(await fs.readFile(path.join(root, 'dist/mcp-server.js'))),
        providerCalls: 0, calls };
    await fs.writeFile(path.join(here, 'results', 'results-type-check.json'), JSON.stringify(data, null, 2) + '\n');
    console.log(JSON.stringify(calls.map(c => ({ files: c.files.length, diagnostics: c.response.diagnostics,
        contextIssues: c.response.contextIssues.length, responseTokens: c.responseTokens, wallMs: c.wallMs })), null, 2));
} finally {
    await client.close();
    if (path.dirname(stage) !== path.resolve(os.tmpdir()) || !path.basename(stage).startsWith('predictive-type-corpus-')) throw Error('Unexpected cleanup path.');
    await fs.rm(stage, { recursive: true, force: true });
}
