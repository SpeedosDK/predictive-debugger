// Capture provider usage while leaving the product's prompt and final reply unchanged.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runProcess } = require('../out/providers/processRunner.js');
const provider = process.argv[2];
const args = process.argv.slice(3);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
    try {
        const env = { ...process.env };
        delete env.CLAUDECODE;
        const id = randomUUID();
        const usagePath = path.join(env.BENCH_USAGE_DIR, `${id}.usage`);
        const captureArgs = [...args];
        if (!args.includes('--version')) {
            if (provider === 'codex') captureArgs.push('--json');
            if (provider === 'copilot') captureArgs.push('--usage-output-file', usagePath);
        }
        const result = await runProcess({ file: env[`BENCH_REAL_${provider.toUpperCase()}`],
            args: captureArgs, input, cwd: process.cwd(), env, timeoutMs: 240_000 });
        if (!args.includes('--version')) {
            let report, raw = result.stdout;
            if (provider === 'claude') {
                report = JSON.parse(result.stdout.trim());
                raw = report.result ?? '';
            } else if (provider === 'codex') {
                report = result.stdout.split(/\r?\n/).filter(Boolean).flatMap(line => {
                    try { return [JSON.parse(line)]; } catch { return []; }
                });
                const at = args.indexOf('--output-last-message');
                raw = at < 0 ? '' : fs.readFileSync(args[at + 1], 'utf8');
            } else {
                report = fs.existsSync(usagePath) ? JSON.parse(fs.readFileSync(usagePath, 'utf8')) : null;
            }
            const hash = text => createHash('sha256').update(text).digest('hex');
            fs.writeFileSync(path.join(env.BENCH_USAGE_DIR, `${id}.json`), JSON.stringify({
                provider, args, prompt: input, promptHash: hash(input), response: raw,
                responseHash: hash(raw), code: result.code, report, stderr: result.stderr
            }));
        }
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        process.exitCode = result.code ?? 1;
    } catch (error) {
        process.stderr.write(String(error));
        process.exitCode = 1;
    }
});
