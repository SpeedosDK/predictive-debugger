// Transparent provider wrapper: retain CLI usage without changing its response.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runProcess } = require('../out/providers/processRunner.js');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
    try {
        const env = { ...process.env };
        delete env.CLAUDECODE;
        // Read before the provider deletes it. Recombined as fullPrompt does, so the
        // hash matches records captured when everything went over stdin.
        const systemAt = process.argv.indexOf('--system-prompt-file');
        const prompt = systemAt === -1 ? input
            : `${fs.readFileSync(process.argv[systemAt + 1], 'utf8')}\n\n${input}`;
        const result = await runProcess({ file: env.BENCH_REAL_CLAUDE, args: process.argv.slice(2),
            input, cwd: process.cwd(), env, timeoutMs: 240_000 });
        if (!process.argv.includes('--version')) {
            let report;
            try { report = JSON.parse(result.stdout.trim()); } catch { report = { parseError: true }; }
            fs.writeFileSync(path.join(env.BENCH_USAGE_DIR, `${randomUUID()}.json`), JSON.stringify({
                promptHash: createHash('sha256').update(prompt).digest('hex'),
                prompt, code: result.code, report
            }));
        }
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        process.exitCode = result.code ?? 1;
    } catch (error) { process.stderr.write(String(error)); process.exitCode = 1; }
});
