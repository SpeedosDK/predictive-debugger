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
/**
 * Which corpus to measure. The JavaScript and TypeScript corpora are kept apart
 * so a change can be shown to help one without quietly hurting the other, and
 * so a figure recorded last week stays comparable to one recorded today.
 *
 * Command-line flags win over environment variables, because an npm script
 * cannot set an environment variable portably across cmd.exe and sh without
 * pulling in a dependency for it.
 */
function flag(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

const CORPUS_DIR = flag("corpus", process.env.BENCH_CORPUS ?? "corpus");
const MANIFEST_FILE = flag("manifest", process.env.BENCH_MANIFEST ?? "manifest.json");
const corpus = path.join(here, CORPUS_DIR);

const tokens = (text) => encode(text).length;

/** How close a predicted line has to be to count as a hit. */
const LINE_TOLERANCE = 3;

/**
 * A defect can have more than one defensible line.
 *
 * A leaked resource is the clearest case: the acquisition and the teardown that
 * fails to release it sit in different methods, and either is a correct answer.
 * Grading only the one the corpus author happened to pick measures the
 * benchmark's taste rather than the tool's accuracy. Manifests without the field
 * fall back to the single planted line.
 */
function isNear(predicted, target) {
    if (predicted == null) {
        return false;
    }
    // Graded against the function the defect lives in. The old line tolerance
    // measured the wrong thing in both directions: on a thirteen-line file three
    // lines either way accepts most of it, so a prediction lands inside by luck;
    // and on a defect with two defensible sites, the acquisition of a resource
    // and the teardown that fails to release it, three lines is too strict and a
    // correct answer scored as a miss. The exact-line count in the summary is
    // the strict companion, and the two are reported together because they
    // disagree.
    const ranges = target.acceptableRanges ?? [];
    if (ranges.length > 0) {
        return ranges.some(([start, end]) => predicted >= start && predicted <= end);
    }
    // Module-level defects have no function to name, and older manifests have no
    // ranges at all.
    const accepted = target.acceptableLines ?? [target.line];
    return accepted.some((line) => Math.abs(predicted - line) <= LINE_TOLERANCE);
}

/**
 * Clean controls, chosen to span the same size range as the buggy files so
 * that "flags the big ones" cannot masquerade as accuracy. Newer manifests
 * carry their own list; this is the fallback for the original JavaScript one.
 */
const DEFAULT_CONTROLS = [
    "src/services/orderService.js",
    "src/api/adminController.js",
    "src/repositories/orderRepository.js",
    "src/lib/paging.js",
    "src/models/payment.js",
    "src/services/auditService.js"
];

const TRIALS = Number(process.env.BENCH_TRIALS ?? 3);
const PROVIDER = process.env.BENCH_PROVIDER ?? "claude";
const OUTPUT_FILE = flag("output", process.env.BENCH_OUTPUT ?? "results-file.json");

if (path.basename(OUTPUT_FILE) !== OUTPUT_FILE || !OUTPUT_FILE.endsWith(".json")) {
    throw new Error("BENCH_OUTPUT must be a .json filename inside bench/");
}

async function main() {
    const manifest = JSON.parse(await fs.readFile(path.join(here, MANIFEST_FILE), "utf8"));
    const controls = manifest.controls ?? DEFAULT_CONTROLS;

    const targets = [
        ...manifest.bugs.map((bug) => ({ ...bug, kind: "buggy" })),
        ...controls.map((file) => ({ file, kind: "clean", line: null, pattern: null }))
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

            // predict_failures returns the verdict flat now, with the metric
            // block and the log stanza behind `verbose`. Fall back to the old
            // nested shape so a results file from before the change can still
            // be reproduced against an older build.
            const parsed = JSON.parse(text);
            const prediction = parsed.aiPrediction ?? parsed;

            // What the agent actually pays: the answer it puts in its context.
            // The full tool response carries static metrics too, so measure the
            // whole thing rather than just the sentence we care about.
            const answerTokens = tokens(text);

            const predictedLine = typeof prediction.line === "number" ? prediction.line : null;
            const saysClean = prediction.pattern === "none" || (prediction.score ?? 0) < 0.2;
            const actionable = parsed.actionable ??
                (prediction.pattern !== "none" &&
                    prediction.pattern !== "unknown" &&
                    (prediction.score ?? 0) >= 0.7);

            let outcome;
            if (target.kind === "clean") {
                outcome = saysClean ? "true-negative" : "false-positive";
            } else if (saysClean) {
                outcome = "false-negative";
            } else if (isNear(predictedLine, target)) {
                outcome = "hit";
            } else {
                outcome = "wrong-location";
            }

            let actionableOutcome;
            if (target.kind === "clean") {
                actionableOutcome = actionable ? "false-positive" : "true-negative";
            } else if (!actionable) {
                actionableOutcome = "false-negative";
            } else if (isNear(predictedLine, target)) {
                actionableOutcome = "hit";
            } else {
                actionableOutcome = "wrong-location";
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
                status: parsed.status ?? (actionable ? "actionable" : saysClean ? "none" : "uncertain"),
                actionable,
                // The two other scores the tool reports, so the question "which
                // of these should an agent gate on" can be answered from the
                // same runs instead of by hand afterwards.
                combinedScore: parsed.combinedScore ?? null,
                staticRisk: parsed.staticRisk ?? parsed.riskScore ?? null,
                reason: prediction.reason ?? null,
                truncated: prediction.truncated ?? null,
                // Recorded so the open questions about the two newest fields
                // can be answered from these runs rather than by hand: does a
                // category missing from `checked` predict lower recall on
                // planted defects of that category, and does asking for a list
                // cost precision. Null on a build that reports neither.
                checked: parsed.checked ?? null,
                findingCount: Array.isArray(parsed.findings) ? parsed.findings.length : null,
                outcome,
                actionableOutcome
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

    // A provider-wide outage used to replace the last valid benchmark with a
    // JSON file containing only failures. Keep the measured baseline intact so
    // a rate limit or expired login cannot destroy the data it was meant to
    // compare against.
    //
    // "All calls failed" was too narrow a guard. A session limit reached partway
    // through let 21 of 36 calls fail, which cleared the whole control group and
    // still counted as a successful run, and the previous results were gone. A
    // partial result cannot answer the questions this file exists to answer, so
    // it is written to a sidecar for inspection and the measured file is left
    // alone.
    const failed = runs.filter((run) => run.error);
    if (failed.length > 0) {
        const sidecar = OUTPUT_FILE.replace(/\.json$/, ".partial.json");
        await fs.writeFile(
            path.join(here, sidecar),
            JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2),
            "utf8"
        );
        const reason = String(failed[0].error).split("\n")[0];
        throw new Error(
            `${failed.length} of ${runs.length} prediction calls failed, so ${OUTPUT_FILE} was ` +
                `left untouched. Partial output is in bench/${sidecar}.\nFirst failure: ${reason}`
        );
    }

    const sum = (arr, key) => arr.reduce((total, run) => total + run[key], 0);
    const count = (arr, outcome) => arr.filter((run) => run.outcome === outcome).length;

    /**
     * Probability that a run on a buggy file scores above a run on a clean one,
     * ties counted as half. 0.5 is a coin toss; below 0.5 the signal is pointing
     * the wrong way.
     *
     * This is the question a calling agent actually has: which number do I gate
     * on? Reporting it for all three scores keeps that answer measured rather
     * than assumed -- an earlier build blended a static complexity score into
     * the headline figure at 0.4 weight without anyone checking whether the
     * static score separated anything.
     */
    const auc = (key) => {
        let wins = 0;
        let pairs = 0;
        for (const b of buggyRuns) {
            for (const c of cleanRuns) {
                if (b[key] == null || c[key] == null) {
                    continue;
                }
                pairs += 1;
                if (b[key] > c[key]) wins += 1;
                else if (b[key] === c[key]) wins += 0.5;
            }
        }
        return pairs === 0 ? null : Number((wins / pairs).toFixed(3));
    };

    const summary = {
        provider: PROVIDER,
        trials: TRIALS,
        buggy: {
            runs: buggyRuns.length,
            hit: count(buggyRuns, "hit"),
            // The strict measure, alongside the one graded by enclosing function.
            // A panel that underlines a single line needs this number.
            exactLine: buggyRuns.filter((run) => run.predictedLine === run.plantedLine).length,
            wrongLocation: count(buggyRuns, "wrong-location"),
            missed: count(buggyRuns, "false-negative")
        },
        clean: {
            runs: cleanRuns.length,
            trueNegative: count(cleanRuns, "true-negative"),
            falsePositive: count(cleanRuns, "false-positive")
        },
        actionable: {
            threshold: 0.7,
            buggy: {
                hit: buggyRuns.filter((run) => run.actionableOutcome === "hit").length,
                wrongLocation: buggyRuns.filter((run) => run.actionableOutcome === "wrong-location").length,
                missed: buggyRuns.filter((run) => run.actionableOutcome === "false-negative").length
            },
            clean: {
                trueNegative: cleanRuns.filter((run) => run.actionableOutcome === "true-negative").length,
                falsePositive: cleanRuns.filter((run) => run.actionableOutcome === "false-positive").length
            }
        },
        context: {
            baselineTokens: sum(ok, "fileTokens"),
            toolTokens: sum(ok, "answerTokens"),
            ratio: Number((sum(ok, "answerTokens") / sum(ok, "fileTokens")).toFixed(3))
        },
        separation: {
            note: "P(buggy run scores above clean run); 0.5 = chance",
            aiScore: auc("score"),
            combinedScore: auc("combinedScore"),
            staticRisk: auc("staticRisk")
        },
        latency: {
            meanMsPerFile: Math.round(sum(ok, "wallClockMs") / Math.max(ok.length, 1)),
            maxMs: Math.max(...ok.map((run) => run.wallClockMs), 0)
        },
        failures: runs.filter((run) => run.error).length
    };

    await fs.writeFile(
        path.join(here, OUTPUT_FILE),
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

    console.log(`\n  Buggy files:  ${summary.buggy.hit}/${summary.buggy.runs} inside the defect's function ` +
        `(${summary.buggy.exactLine} exactly on the line), ` +
        `${summary.buggy.wrongLocation} pointed elsewhere, ${summary.buggy.missed} reported clean`);
    console.log(`  Clean files:  ${summary.clean.falsePositive}/${summary.clean.runs} false positives`);
    console.log(`  Actionable:   ${summary.actionable.buggy.hit}/${buggyRuns.length} planted lines, ` +
        `${summary.actionable.clean.falsePositive}/${cleanRuns.length} false positives at >= ${summary.actionable.threshold}`);
    console.log(`\n  Context: ${summary.context.baselineTokens.toLocaleString()} tokens to read the files, ` +
        `${summary.context.toolTokens.toLocaleString()} to ask the tool (${(summary.context.ratio * 100).toFixed(1)}%)`);
    console.log(`  Latency: ${summary.latency.meanMsPerFile} ms mean per file, ${summary.latency.maxMs} ms worst`);
    console.log(`  Separation (AUC, 0.5 = chance): model score ${summary.separation.aiScore}, ` +
        `combined ${summary.separation.combinedScore}, static risk ${summary.separation.staticRisk}`);
    if (summary.failures > 0) {
        console.log(`  ${summary.failures} call(s) failed outright`);
    }
    console.log(`\nwrote bench/${OUTPUT_FILE}\n`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
