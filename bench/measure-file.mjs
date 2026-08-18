/**
 * Per-file benchmark: the claim under test.
 *
 * Baseline   the agent reads the whole file into its context and finds the bug
 *            itself. Cost = every token of the file.
 * With tool  the agent calls predict_failures and gets back a line number, a
 *            pattern and a one-line reason. Cost = the tokens of that answer.
 *
 * Two things decide whether the tool is worth it, and measuring only the first
 * would be dishonest:
 *
 *   1. context saved  -- file tokens vs answer tokens
 *   2. answer quality -- does it point at the planted line, and does it cry
 *                        wolf on clean files? If the agent has to read the file
 *                        anyway to check, the saving is imaginary.
 *
 * Clean control files are included precisely to measure (2). A tool that
 * reports a plausible-sounding bug in every file it is shown has a recall of
 * 100% and is worthless.
 *
 * The tokens do not vanish: they move to a second model. What is saved is the
 * calling agent's context window, not total spend. Reported as such.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { encode } from "gpt-tokenizer";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const corpus = path.join(here, "corpus");

const tokens = (text) => encode(text).length;

/** How close a predicted line has to be to count as a hit. */
const LINE_TOLERANCE = 3;

/**
 * Clean controls, chosen to span the same size range as the buggy files so
 * that "flags the big ones" cannot masquerade as accuracy.
 */
const CONTROLS = [
    "src/services/orderService.js",
    "src/api/adminController.js",
    "src/repositories/orderRepository.js",
    "src/lib/paging.js",
    "src/models/payment.js",
    "src/services/auditService.js"
];

const TRIALS = Number(process.env.BENCH_TRIALS ?? 3);
const PROVIDER = process.env.BENCH_PROVIDER ?? "claude";

async function main() {
    const manifest = JSON.parse(await fs.readFile(path.join(here, "manifest.json"), "utf8"));

    const targets = [
        ...manifest.bugs.map((bug) => ({ ...bug, kind: "buggy" })),
        ...CONTROLS.map((file) => ({ file, kind: "clean", line: null, pattern: null }))
    ];

    for (const target of targets) {
        const source = await fs.readFile(path.join(corpus, target.file), "utf8");
        target.fileTokens = tokens(source);
        target.fileLines = source.split("\n").length;
    }

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(repoRoot, "dist", "mcp-server.js")],
        cwd: repoRoot
    });
    const client = new Client({ name: "predictive-debugger-bench", version: "1.0.0" });
    await client.connect(transport);

    const runs = [];

    for (const target of targets) {
        for (let trial = 1; trial <= TRIALS; trial++) {
            const started = performance.now();
            let text;
            let failed = null;

            try {
                const response = await client.callTool({
                    name: "predict_failures",
                    arguments: { file: path.join(corpus, target.file), provider: PROVIDER }
                });
                text = response.content.map((part) => part.text).join("");
                if (response.isError) {
                    failed = text;
                }
            } catch (err) {
                failed = err instanceof Error ? err.message : String(err);
                text = "";
            }

            const wallClockMs = Math.round(performance.now() - started);

            if (failed) {
                runs.push({ ...target, trial, wallClockMs, error: failed });
                process.stderr.write(`  ${target.file} trial ${trial}: FAILED ${failed}\n`);
                continue;
            }

            const parsed = JSON.parse(text);
            const prediction = parsed.aiPrediction ?? {};

            // What the agent actually pays: the answer it puts in its context.
            // The full tool response carries static metrics too, so measure the
            // whole thing rather than just the sentence we care about.
            const answerTokens = tokens(text);

            const predictedLine = typeof prediction.line === "number" ? prediction.line : null;
            const saysClean = prediction.pattern === "none" || (prediction.score ?? 0) < 0.2;

            let outcome;
            if (target.kind === "clean") {
                outcome = saysClean ? "true-negative" : "false-positive";
            } else if (saysClean) {
                outcome = "false-negative";
            } else if (predictedLine != null && Math.abs(predictedLine - target.line) <= LINE_TOLERANCE) {
                outcome = "hit";
            } else {
                outcome = "wrong-location";
            }

            runs.push({
                file: target.file,
                kind: target.kind,
                trial,
                plantedLine: target.line,
                plantedPattern: target.pattern,
                fileTokens: target.fileTokens,
                fileLines: target.fileLines,
                answerTokens,
                wallClockMs,
                predictedLine,
                predictedPattern: prediction.pattern ?? null,
                score: prediction.score ?? null,
                reason: prediction.reason ?? null,
                truncated: prediction.truncated ?? null,
                outcome
            });

            process.stderr.write(
                `  ${target.file} trial ${trial}: ${outcome} (${wallClockMs} ms, line ${predictedLine ?? "-"})\n`
            );
        }
    }

    await client.close();

    /* ---- aggregate ---- */

    const ok = runs.filter((run) => !run.error);
    const buggyRuns = ok.filter((run) => run.kind === "buggy");
    const cleanRuns = ok.filter((run) => run.kind === "clean");

    const sum = (arr, key) => arr.reduce((total, run) => total + run[key], 0);
    const count = (arr, outcome) => arr.filter((run) => run.outcome === outcome).length;

    const summary = {
        provider: PROVIDER,
        trials: TRIALS,
        buggy: {
            runs: buggyRuns.length,
            hit: count(buggyRuns, "hit"),
            wrongLocation: count(buggyRuns, "wrong-location"),
            missed: count(buggyRuns, "false-negative")
        },
        clean: {
            runs: cleanRuns.length,
            trueNegative: count(cleanRuns, "true-negative"),
            falsePositive: count(cleanRuns, "false-positive")
        },
        context: {
            baselineTokens: sum(ok, "fileTokens"),
            toolTokens: sum(ok, "answerTokens"),
            ratio: Number((sum(ok, "answerTokens") / sum(ok, "fileTokens")).toFixed(3))
        },
        latency: {
            meanMsPerFile: Math.round(sum(ok, "wallClockMs") / Math.max(ok.length, 1)),
            maxMs: Math.max(...ok.map((run) => run.wallClockMs), 0)
        },
        failures: runs.filter((run) => run.error).length
    };

    await fs.writeFile(
        path.join(here, "results-file.json"),
        JSON.stringify({ generatedAt: new Date().toISOString(), summary, runs }, null, 2),
        "utf8"
    );

    /* ---- report ---- */

    const perFile = new Map();
    for (const run of ok) {
        if (!perFile.has(run.file)) {
            perFile.set(run.file, []);
        }
        perFile.get(run.file).push(run);
    }

    console.log(`\nProvider: ${PROVIDER}   trials per file: ${TRIALS}\n`);
    console.log(
        `  ${"file".padEnd(38)}${"kind".padEnd(7)}${"file tok".padStart(9)}${"ans tok".padStart(9)}${"mean ms".padStart(9)}  outcomes`
    );
    console.log("  " + "-".repeat(96));

    for (const [file, fileRuns] of perFile) {
        const outcomes = fileRuns.map((run) => run.outcome);
        const meanMs = Math.round(sum(fileRuns, "wallClockMs") / fileRuns.length);
        const meanAns = Math.round(sum(fileRuns, "answerTokens") / fileRuns.length);
        console.log(
            `  ${file.padEnd(38)}${fileRuns[0].kind.padEnd(7)}${String(fileRuns[0].fileTokens).padStart(9)}${String(meanAns).padStart(9)}${String(meanMs).padStart(9)}  ${outcomes.join(", ")}`
        );
    }

    console.log(`\n  Buggy files:  ${summary.buggy.hit}/${summary.buggy.runs} hit the planted line (+-${LINE_TOLERANCE}), ` +
        `${summary.buggy.wrongLocation} pointed elsewhere, ${summary.buggy.missed} reported clean`);
    console.log(`  Clean files:  ${summary.clean.falsePositive}/${summary.clean.runs} false positives`);
    console.log(`\n  Context: ${summary.context.baselineTokens.toLocaleString()} tokens to read the files, ` +
        `${summary.context.toolTokens.toLocaleString()} to ask the tool (${(summary.context.ratio * 100).toFixed(1)}%)`);
    console.log(`  Latency: ${summary.latency.meanMsPerFile} ms mean per file, ${summary.latency.maxMs} ms worst`);
    if (summary.failures > 0) {
        console.log(`  ${summary.failures} call(s) failed outright`);
    }
    console.log(`\nwrote bench/results-file.json\n`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
