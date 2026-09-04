/**
 * Section 8: what a sub-agent adds, on the corpus everything else is measured on.
 *
 * Section 6 put two agents on the same four files: one that reads them, one that
 * calls `predict_failures`. This runs that A/B again with the same files, the
 * same answer key and the same grading rule, and adds the two arms the MCP
 * `instructions` rule actually turns on:
 *
 *   read           reads the files and reasons about them. Section 6, arm A.
 *   tool           calls predict_failures, never opens the source. Section 6, arm B.
 *   subagent       delegates to a scoped sub-agent and acts on its report.
 *   tool+subagent  calls the tool, then hands the file and the tool's report to
 *                  a scoped sub-agent.
 *
 * `subagent` against `tool+subagent` is the comparison the routing in the
 * instructions depends on. If the tool adds nothing once a sub-agent is already
 * looking, the cheap seat is not a seat at all, and the rule should send
 * everything straight to the sub-agent. If the sub-agent adds nothing over the
 * tool, the expensive seat is not worth its wall-clock.
 *
 * Nothing new is fixtured. The files are `bench/corpus`, the key is
 * `bench/manifest.json`, and a hit is graded by enclosing function exactly as
 * section 6 grades it, so the numbers here sit next to section 6's rather than
 * beside it.
 *
 * Compliance is verified, not assumed: `subagent_stats.spawned` comes from the
 * CLI's own accounting, and predict.mjs writes a marker when it is called. An
 * arm that skipped its instruction is a copy of a cheaper arm wearing the wrong
 * name, so it is recorded and then excluded from the aggregates.
 *
 *   node bench/measure-agents.mjs
 *   node bench/measure-agents.mjs --arms=subagent,tool+subagent --trials=5
 *   node bench/measure-agents.mjs --all --model=haiku
 *
 * Runs append to bench/results-agents.json as they finish, and an interrupted
 * run resumes where it stopped.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { acceptableRanges } from "./enclosing-function.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const CORPUS = path.join(here, "corpus");
const PREDICT = path.join(here, "predict.mjs");

function flag(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

// A separate file, not a merge into the default, because a row recorded under
// a different prompt or tool version is not a resume of the same experiment --
// see the batched-vs-serial `tool` arm in bench/RESULTS.md for why this matters.
const OUTPUT = path.join(here, flag("out", "results-agents.json"));

const ARMS = ["read", "tool", "subagent", "tool+subagent"];

/**
 * The four files section 6 used. Kept as the default so a run of this script is
 * directly comparable to the table already in RESULTS.md; `--all` widens to
 * every planted bug and every control in the key, which is the better sample and
 * the more expensive one.
 */
const SECTION_SIX_FILES = [
    "src/services/pricingService.js",
    "src/workers/reconciliationWorker.js",
    "src/models/cartTotals.js",
    "src/services/orderService.js"
];

const selectedArms = flag("arms", process.env.BENCH_AGENTS_ARMS ?? ARMS.join(",")).split(",");
const trials = Number(flag("trials", process.env.BENCH_AGENTS_TRIALS ?? "3"));
const model = flag("model", process.env.BENCH_AGENTS_MODEL ?? "sonnet");
const TIMEOUT_MS = Number(flag("timeout", "900000"));
const useAll = process.argv.includes("--all");
/**
 * Seconds to wait between runs.
 *
 * Not politeness. A burst of back-to-back sessions tripped a rate limit part way
 * through a sonnet grid and every remaining run failed instantly, which reads in
 * the results file as an arm that cannot do the task rather than an arm that was
 * never asked. Pacing costs wall-clock the benchmark does not measure.
 */
const delayMs = Number(flag("delay", process.env.BENCH_AGENTS_DELAY ?? "0")) * 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const arm of selectedArms) {
    if (!ARMS.includes(arm)) {
        console.error(`unknown arm: ${arm}`);
        console.error(`known arms: ${ARMS.join(", ")}`);
        process.exit(2);
    }
}

const manifest = JSON.parse(await fs.readFile(path.join(here, "manifest.json"), "utf8"));
const files = useAll
    ? [...manifest.bugs.map((bug) => bug.file), ...manifest.controls]
    : SECTION_SIX_FILES;

/**
 * The answer key for the selected files, with each planted line widened to the
 * function that contains it.
 *
 * Widening happens here rather than at grading time so it is done once against
 * the corpus source, and so a file whose defect sits at module level falls back
 * to the planted line rather than silently accepting the whole file.
 */
async function buildKey() {
    const key = new Map();
    for (const file of files) {
        const bug = manifest.bugs.find((entry) => entry.file === file);
        if (!bug) {
            key.set(file, { defect: false });
            continue;
        }
        const source = await fs.readFile(path.join(CORPUS, file), "utf8");
        const lines = bug.acceptableLines ?? [bug.line];
        key.set(file, {
            defect: true,
            line: bug.line,
            acceptableLines: lines,
            ranges: acceptableRanges(source, lines)
        });
    }
    return key;
}

const key = await buildKey();

/** Did a predicted line land in the right place to look? */
function isHit(entry, line) {
    if (typeof line !== "number" || Number.isNaN(line)) {
        return false;
    }
    if (entry.ranges.length > 0) {
        return entry.ranges.some(([start, end]) => line >= start && line <= end);
    }
    // Module-level defect: no function to name, so fall back to the tolerance
    // the benchmark used before the enclosing-function rule replaced it.
    return entry.acceptableLines.some((accepted) => Math.abs(accepted - line) <= 3);
}

const VERDICT_FORMAT =
    `Finish your reply with one JSON array and nothing after it, in this shape:\n` +
    `[{"file": "<the relative path>", "defect": true, "line": 12, "reason": "one sentence"}]\n` +
    `Use "defect": false and "line": null for a file with no defect. ` +
    `One entry per file, in the order given.`;

function taskPrompt(arm, staged) {
    const list = files.map((file) => `- ${file}`).join("\n");
    const paths = files.map((file) => path.join(staged, file));

    const shared =
        `Name the single most likely runtime failure in each of these files, or report none:\n` +
        `${list}\n\n`;

    const toolStep =
        `Do not open the source files. Review all of them in one call:\n` +
        `  node "${PREDICT}" ${paths.map((p) => `"${p}"`).join(" ")}\n` +
        `The reply has a "results" array, one entry per file in the order given. ` +
        `Report a defect for a file only when its entry says "actionable": true.`;

    const subagentStep =
        `Launch one sub-agent and give it the absolute paths above, scoped to those ` +
        `files only. Ask it to name the single most likely runtime failure in each, ` +
        `with a line number, or report none. Base your verdicts on what it reports.`;

    switch (arm) {
        case "read":
            return `${shared}Read each file and reason about it. Do not use any analysis tool and do not launch a sub-agent.\n\n${VERDICT_FORMAT}`;
        case "tool":
            return `${shared}${toolStep}\nDo not launch a sub-agent.\n\n${VERDICT_FORMAT}`;
        case "subagent":
            return `${shared}Do not read the files yourself and do not use any analysis tool. ${subagentStep}\n\n${VERDICT_FORMAT}`;
        case "tool+subagent":
            return `${shared}${toolStep}\n\nThen, separately: ${subagentStep} Where the tool and the sub-agent disagree, decide for yourself.\n\n${VERDICT_FORMAT}`;
        default:
            throw new Error(`no prompt for arm ${arm}`);
    }
}

async function claude(prompt, options) {
    // stdin rather than argv: the CLI is reached through a .cmd shim on Windows
    // and cmd.exe concatenates arguments without escaping, which a multi-line
    // prompt full of quoted absolute paths does not survive.
    const args = [
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--dangerously-skip-permissions"
    ];

    const started = Date.now();
    const result = await run("claude", args, options.cwd, {
        shell: true,
        stdin: prompt,
        timeoutMs: TIMEOUT_MS,
        env: { BENCH_PREDICT_LOG: options.logFile }
    });
    const wallMs = Date.now() - started;

    let report;
    try {
        report = JSON.parse(result.stdout.trim());
    } catch {
        // Both streams are kept. A CLI that refuses -- a rate limit, an expired
        // login -- says so on stdout in plain text, and throwing that away is
        // what turned seventeen failed runs into seventeen blank records.
        return {
            failed: true,
            wallMs,
            code: result.code,
            stdout: result.stdout.slice(-2000),
            stderr: result.stderr.slice(-2000)
        };
    }

    const usage = report.usage ?? {};
    const fresh = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
    const modelTokens = Object.values(report.modelUsage ?? {}).reduce(
        (totals, entry) => ({
            billable: totals.billable + (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0),
            context:
                totals.context +
                (entry.inputTokens ?? 0) +
                (entry.outputTokens ?? 0) +
                (entry.cacheReadInputTokens ?? 0) +
                (entry.cacheCreationInputTokens ?? 0)
        }),
        { billable: 0, context: 0 }
    );
    return {
        failed: report.is_error === true,
        text: typeof report.result === "string" ? report.result : "",
        wallMs,
        durationMs: report.duration_ms ?? wallMs,
        costUsd: report.total_cost_usd ?? 0,
        turns: report.num_turns ?? 0,
        subagentsSpawned: report.subagent_stats?.spawned ?? 0,
        // Summed from `modelUsage` rather than `usage`. The top-level `usage`
        // block counts only the parent turn, so an arm that delegates shows a
        // cost the tokens cannot account for; `modelUsage` is per model and
        // includes whatever a sub-agent spent.
        billableTokens: modelTokens.billable || fresh,
        contextTokens:
            modelTokens.context ||
            fresh +
                (usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0)
    };
}

/**
 * The last JSON array in the reply.
 *
 * Scanning from the end rather than the start because a reply that reasons in
 * prose before answering will often contain a bracketed aside first, and the
 * verdict was asked for last.
 */
function parseVerdicts(text) {
    const starts = [];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === "[") starts.push(i);
    }
    for (const start of starts.reverse()) {
        for (let end = text.length; end > start; end -= 1) {
            if (text[end - 1] !== "]") continue;
            try {
                const value = JSON.parse(text.slice(start, end));
                if (Array.isArray(value) && value.every((v) => v && typeof v === "object")) {
                    return value;
                }
            } catch {
                // Not a complete array at this pair; keep shrinking.
            }
        }
    }
    return null;
}

function score(verdicts) {
    const byFile = new Map();
    for (const verdict of verdicts ?? []) {
        const named = String(verdict.file ?? "").replace(/\\/g, "/");
        const match = files.find((file) => named === file || named.endsWith(file));
        if (match && !byFile.has(match)) {
            byFile.set(match, verdict);
        }
    }

    const perFile = [];
    let bugsFound = 0;
    let bugsTotal = 0;
    let exactHits = 0;
    let falseAlarms = 0;
    let controlsTotal = 0;
    let missing = 0;

    for (const file of files) {
        const entry = key.get(file);
        const verdict = byFile.get(file);
        if (!verdict) missing += 1;

        const claimed = verdict?.defect === true;
        const line = typeof verdict?.line === "number" ? verdict.line : null;

        if (entry.defect) {
            bugsTotal += 1;
            const hit = claimed && isHit(entry, line);
            if (hit) bugsFound += 1;
            if (claimed && line !== null && entry.acceptableLines.includes(line)) exactHits += 1;
            perFile.push({ file, truth: "bug", claimed, line, correct: hit });
        } else {
            controlsTotal += 1;
            if (claimed) falseAlarms += 1;
            perFile.push({ file, truth: "clean", claimed, line, correct: !claimed });
        }
    }

    return {
        bugsFound,
        bugsTotal,
        exactHits,
        falseAlarms,
        controlsTotal,
        missingVerdicts: missing,
        recall: bugsTotal === 0 ? 0 : bugsFound / bugsTotal,
        perFile
    };
}

/** Copy the corpus files under test into a scratch directory. */
async function stage(destination) {
    for (const file of files) {
        const target = path.join(destination, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(CORPUS, file), target);
    }
}

async function runOnce(arm, trial) {
    // The corpus is staged outside the repository so that bench/manifest.json --
    // the answer key -- is not sitting one directory above the agent's cwd.
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "agents-"));
    const logFile = `${scratch}.predict.log`;
    await fs.writeFile(logFile, "");

    try {
        await stage(scratch);
        const turn = await claude(taskPrompt(arm, scratch), { cwd: scratch, logFile });
        if (turn.failed) {
            return {
                arm,
                trial,
                ok: false,
                wallMs: turn.wallMs,
                code: turn.code,
                detail: [turn.stdout, turn.stderr].filter(Boolean).join(" | ").slice(-2000)
            };
        }

        const verdicts = parseVerdicts(turn.text);
        const log = await fs.readFile(logFile, "utf8");
        const predictCalls = log.split("\n").filter(Boolean).length;
        const wantsTool = arm === "tool" || arm === "tool+subagent";
        const wantsSubagent = arm === "subagent" || arm === "tool+subagent";

        return {
            arm,
            trial,
            ok: true,
            parsed: verdicts !== null,
            compliant:
                verdicts !== null &&
                wantsTool === predictCalls > 0 &&
                wantsSubagent === turn.subagentsSpawned > 0,
            predictCalls,
            subagentsSpawned: turn.subagentsSpawned,
            ...score(verdicts),
            wallMs: turn.wallMs,
            durationMs: turn.durationMs,
            costUsd: turn.costUsd,
            turns: turn.turns,
            billableTokens: turn.billableTokens,
            contextTokens: turn.contextTokens
        };
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
        await fs.rm(logFile, { force: true });
    }
}

/**
 * Spawn a child and collect its output.
 *
 * `shell` is opt-in rather than the Windows default: going through cmd.exe
 * concatenates arguments without escaping, which breaks any path containing a
 * space. The CLI shim needs it; nothing else here does.
 */
function run(command, args, cwd, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            shell: options.shell === true,
            env: { ...process.env, ...options.env }
        });
        let stdout = "";
        let stderr = "";
        const timer = options.timeoutMs
            ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
            : null;
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            if (timer) clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
        if (options.stdin !== undefined) {
            child.stdin.write(options.stdin);
        }
        child.stdin.end();
    });
}

const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const sd = (xs) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

function summarise(runs) {
    const usable = runs.filter((r) => r.ok && r.compliant);
    const of = (field) => usable.map((r) => r[field]);
    return {
        runs: runs.length,
        usable: usable.length,
        nonCompliant: runs.filter((r) => r.ok && !r.compliant).length,
        failed: runs.filter((r) => !r.ok).length,
        meanBugsFound: mean(of("bugsFound")),
        sdBugsFound: sd(of("bugsFound")),
        bugsTotal: usable[0]?.bugsTotal ?? 0,
        meanExactHits: mean(of("exactHits")),
        meanFalseAlarms: mean(of("falseAlarms")),
        controlsTotal: usable[0]?.controlsTotal ?? 0,
        meanBillableTokens: mean(of("billableTokens")),
        meanContextTokens: mean(of("contextTokens")),
        meanCostUsd: mean(of("costUsd")),
        meanWallMs: mean(of("wallMs")),
        sdWallMs: sd(of("wallMs")),
        meanTurns: mean(of("turns"))
    };
}

let existing = null;
try {
    existing = JSON.parse(await fs.readFile(OUTPUT, "utf8"));
} catch {
    existing = null;
}
// A results file recorded against another model or another file set is not a
// partial run of this one; blending them would put two experiments under one
// set of headline numbers.
const comparable =
    existing && existing.model === model && existing.files.join(",") === files.join(",");
const results = comparable ? existing.results : [];
const cellOf = (r) => `${r.arm}|${r.trial}`;
const done = new Set(results.filter((r) => r.ok).map(cellOf));

const planned = [];
for (const arm of selectedArms) {
    for (let trial = 1; trial <= trials; trial += 1) {
        if (!done.has(`${arm}|${trial}`)) planned.push({ arm, trial });
    }
}

console.log(
    `agent benchmark: ${planned.length} runs to go ` +
        `(${selectedArms.length} arms x ${trials} trials over ${files.length} files, model ${model})`
);
if (results.length > 0) console.log(`resuming — ${results.length} already recorded`);

for (const [index, cell] of planned.entries()) {
    if (index > 0 && delayMs > 0) {
        await pause(delayMs);
    }
    process.stdout.write(`[${index + 1}/${planned.length}] ${cell.arm} #${cell.trial} ... `);
    const record = await runOnce(cell.arm, cell.trial);
    const stale = results.findIndex((r) => cellOf(r) === cellOf(record));
    if (stale >= 0) results.splice(stale, 1);
    results.push(record);

    if (!record.ok) {
        console.log(`FAILED (code ${record.code ?? "?"}, ${record.wallMs}ms)`);
    } else {
        console.log(
            `${record.bugsFound}/${record.bugsTotal} bugs, ` +
                `${record.falseAlarms}/${record.controlsTotal} false alarms, ` +
                `${(record.wallMs / 1000).toFixed(0)}s, $${record.costUsd.toFixed(3)}` +
                `${record.compliant ? "" : " (non-compliant)"}`
        );
    }

    const byArm = {};
    for (const arm of selectedArms) {
        byArm[arm] = summarise(results.filter((r) => r.arm === arm));
    }
    await fs.writeFile(
        OUTPUT,
        JSON.stringify(
            {
                note:
                    "Section 8. The same corpus, answer key and enclosing-function grading as " +
                    "section 6, with two arms added: a scoped sub-agent, and the tool followed " +
                    "by a scoped sub-agent. Non-compliant runs -- an arm that was told to spawn " +
                    "a sub-agent and did not, or one that used a tool it was told to avoid -- " +
                    "are recorded and excluded from the aggregates.",
                ranAt: new Date().toISOString().slice(0, 10),
                model,
                trials,
                files,
                arms: selectedArms,
                byArm,
                results
            },
            null,
            1
        )
    );
}

console.log(`\nwrote ${path.relative(repoRoot, OUTPUT)}`);
