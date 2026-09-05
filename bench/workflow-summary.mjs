/** Reject incomplete accounting and stale judgments before producing graph data. */
export function usage(report) {
    if (report?.modelUsage && Object.keys(report.modelUsage).length) {
        const result = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0, cost: report.total_cost_usd };
        if (!Number.isFinite(result.cost) || result.cost < 0) throw Error('Missing CLI usage or cost.');
        for (const model of Object.values(report.modelUsage)) {
            for (const [key, field] of Object.entries({ input: 'inputTokens', output: 'outputTokens',
                cacheWrite: 'cacheCreationInputTokens', cacheRead: 'cacheReadInputTokens' })) {
                if (!Number.isFinite(model[field]) || model[field] < 0) throw Error('Missing CLI model usage.');
                result[key] += model[field]; result.total += model[field];
            }
        }
        return result;
    }
    const u = report?.usage;
    const keys = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
    if (!u || keys.some(key => !Number.isFinite(u[key]) || u[key] < 0) ||
        !Number.isFinite(report.total_cost_usd) || report.total_cost_usd < 0) {
        throw Error('Missing CLI usage or cost; cannot claim complete accounting.');
    }
    return { input: u.input_tokens, output: u.output_tokens,
        cacheWrite: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens,
        total: keys.reduce((sum, key) => sum + u[key], 0), cost: report.total_cost_usd };
}
const empty = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0, cost: 0 });
function add(a, b) { for (const key of Object.keys(a)) a[key] += b[key]; }
export function summarize(data, judgments) {
    if (data.status !== 'complete' || data.runs.length !== data.config.trials * 3 || data.runs.some(r => r.failed)) {
        throw Error('Workflow comparison is incomplete.');
    }
    return ['read', 'previous', 'current'].map(arm => {
        const runs = data.runs.filter(r => r.arm === arm);
        if (runs.length !== data.config.trials || new Set(runs.map(r => r.trial)).size !== runs.length) throw Error('Missing or duplicate trials.');
        const row = { arm, label: { read: 'Agent reads files', previous: 'Agent + v0.6 master', current: 'Agent + v0.7 candidate' }[arm],
            bugs: 0, detected: 0, otherVerified: 0, controls: 0, falseAlarms: 0, caller: empty(), internal: empty(), wallMs: 0 };
        for (const run of runs) {
            if (run.internal.length !== (arm === 'read' ? 0 : data.config.targets.length)) {
                throw Error('Missing internal provider calls.');
            }
            add(row.caller, usage(run.report));
            for (const inner of run.internal) add(row.internal, usage(inner.report));
            row.wallMs += run.wallMs;
            for (const target of data.config.targets) {
                const verdicts = run.verdicts.filter(v => v.file === target.file);
                if (verdicts.length !== 1 || typeof verdicts[0].defect !== 'boolean') throw Error('Missing verdict.');
                const verdict = verdicts[0];
                if (target.kind === 'buggy') row.bugs++; else row.controls++;
                if (!verdict.defect) continue;
                const judgment = judgments[`${run.id}/${target.file}`];
                if (!judgment || typeof judgment.matchesDefect !== 'boolean' || judgment.sourceHash !== target.sourceHash ||
                    judgment.promptHash !== run.promptHash || judgment.responseHash !== run.responseHash) {
                    throw Error(`Missing or stale judgment: ${run.id}/${target.file}`);
                }
                if (target.kind === 'buggy' && judgment.matchesDefect) row.detected++;
                if (target.kind === 'buggy' && !judgment.matchesDefect && judgment.validDefect === true) row.otherVerified++;
                if (target.kind === 'clean') row.falseAlarms++;
            }
        }
        row.total = empty(); add(row.total, row.caller); add(row.total, row.internal);
        return row;
    });
}
