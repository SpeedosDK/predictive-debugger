/** Build the pinned master commit in a detached worktree with its own lockfile. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, '.tmp/benchmark-master');
const require = createRequire(import.meta.url);
const { runProcess } = require('../out/providers/processRunner.js');
const { which } = require('../out/providers/locate.js');
const baseline = JSON.parse(await fs.readFile(path.join(root, 'bench/results/baseline-master.json'), 'utf8'));
async function run(file, args, cwd) {
    const result = await runProcess({ file, args, cwd, timeoutMs: 240_000 });
    if (result.code !== 0) throw Error(result.stdout + result.stderr);
    return result.stdout.trim();
}
const git = which('git');
try { await fs.access(target); }
catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await run(git, ['worktree', 'add', '--detach', target, baseline.revision], root);
}
if (await run(git, ['rev-parse', 'HEAD'], target) !== baseline.revision) throw Error('Baseline checkout is at a different commit.');
await run(git, ['diff', '--exit-code', 'HEAD'], target);
const npm = which('npm');
try { await fs.access(path.join(target, 'node_modules')); }
catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await run(npm, ['ci', '--ignore-scripts'], target);
}
await run(npm, ['run', 'compile'], target);
await run(npm, ['run', 'build'], target);
await run(process.execPath, [path.join(target, '.github/scripts/check-mcp.mjs')], target);
console.log(`Built clean master baseline ${baseline.revision.slice(0, 7)} (v${baseline.version}).`);
