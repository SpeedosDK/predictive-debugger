/**
 * Renders bench/RESULTS.md plus the standalone SVGs it links to.
 *
 * A .svg committed to the repo is rendered by GitHub as an image with no access
 * to the surrounding page's CSS, so each chart is written twice with literal
 * colours and paired in a <picture> element. Every chart is also given as a
 * markdown table, so the file is readable with no image rendering at all.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
    THEMES,
    OUTCOME,
    render,
    contextSpec,
    outcomeSpec,
    scoreSpec,
    budgetSpec,
    providerSpec
} from "./charts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const chartDir = path.join(here, "charts");

const read = async (name) => JSON.parse(await fs.readFile(path.join(here, name), "utf8"));
const fmt = (n) => n.toLocaleString("en-US");
const dec = (n, digits = 1) => n.toFixed(digits);
const pct = (n, digits = 0) => `${dec(n * 100, digits)}%`;

/** One chart, two themes, plus the <picture> block that selects between them. */
async function emit(name, buildSpec, altText) {
    for (const [mode, c] of Object.entries(THEMES)) {
        await fs.writeFile(
            path.join(chartDir, `${name}.${mode}.svg`),
            await render(buildSpec(c), c),
            "utf8"
        );
    }

    return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/${name}.dark.svg">
  <img alt="${altText}" src="charts/${name}.light.svg">
</picture>

[Open this chart at full size](charts/${name}.light.svg)`;
}

function table(headers, rows) {
    const head = `| ${headers.join(" | ")} |`;
    const rule = `|${headers.map(() => "---").join("|")}|`;
    const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
    return `${head}\n${rule}\n${body}`;
}

/** A table cell must make sense without the chart's colour and symbol legend. */
function outcomeText(run) {
    const line = run.predictedLine == null ? "" : ` (line ${run.predictedLine})`;
    switch (run.outcome) {
        case "hit":
            return `Hit${line}`;
        case "wrong-location":
            return `Wrong location${line}`;
        case "false-negative":
            return "Missed (no finding)";
        case "true-negative":
            return run.predictedLine == null
                ? "Correctly clean"
                : `Suppressed low-confidence guess${line}`;
        case "false-positive":
            return `False alarm${line}`;
        default:
            return String(run.outcome);
    }
}

async function main() {
    await fs.mkdir(chartDir, { recursive: true });

    const project = await read("results.json");
    const file = await read("results-file.json");
    const ab = await read("results-ab.json");
    const before = await read("baseline.json");
    const precision = await read("results-file-precision-codex.json");
    // The TypeScript corpus is measured separately, so a change can be shown to
    // help one language without quietly hurting the other.
    const ts = await read("results-file-ts.json");
    const tsManifest = await read("manifest-ts.json");
    const { summary, runs } = file;

    const ok = runs.filter((r) => !r.error);

    // Whether the smallest file in the set is still cheaper to read than to ask
    // about depends on the size of the reply, so state it from the data.
    const smallestFile = [...ok].sort((a, b) => a.fileTokens - b.fileTokens)[0];
    const breakEvenNote =
        smallestFile.answerTokens < smallestFile.fileTokens
            ? `Even \`${smallestFile.file.replace(/^src\//, "")}\`, the smallest file here at ` +
              `${smallestFile.fileTokens} tokens, is cheaper to ask about than to read.`
            : `For \`${smallestFile.file.replace(/^src\//, "")}\`, at ${smallestFile.fileTokens} tokens, ` +
              "asking still costs more than reading.";

    // Stated from the data rather than asserted: whichever way the ranking
    // came out this run, the prose has to match it.
    const ranks = project.bugRanks.map((b) => b.rank).sort((a, b) => a - b);
    const found = project.bugRanks.filter((b) => b.rank <= 15).length;
    const missed = project.bugRanks.filter((b) => b.rank > project.corpus.files / 2);
    const bugRankSentence =
        `The planted bugs land at ranks ${ranks.join(", ")} of ${project.corpus.files}, ` +
        `so ${found} of ${project.corpus.bugs} are inside the first 15 files. ` +
        (missed.length === 0
            ? "None are stranded at the bottom of the ranking."
            : `The ${missed.length} at the bottom, ${missed
                  .map((b) => `\`${b.file.replace("src/", "")}\``)
                  .join(" and ")}, show the limit of the method. A missing null check in a ` +
              "short mapper has no structural signature at all, and no complexity heuristic will " +
              "rank it. Reading them costs almost nothing, which is " +
              "the argument for a density ordering rather than an excuse for missing them.");

    const perFileMap = new Map();
    for (const run of ok) {
        if (!perFileMap.has(run.file)) {
            perFileMap.set(run.file, {
                file: run.file,
                kind: run.kind,
                plantedLine: run.plantedLine,
                runs: []
            });
        }
        perFileMap.get(run.file).runs.push(run);
    }
    const perFile = [...perFileMap.values()].sort((a, b) => b.runs[0].fileTokens - a.runs[0].fileTokens);

    // Name a file whose trials disagree, rather than one that used to.
    const unstable = perFile.filter((e) => new Set(e.runs.map((r) => r.outcome)).size > 1);
    const varianceNote = unstable.length
        ? `\`${unstable[0].file.replace(/^src\//, "")}\` came out ` +
          unstable[0].runs
              .map((r) => outcomeText(r).toLowerCase())
              .join(", ") +
          " across its three trials."
        : "On this run every file gave the same outcome in all three trials, which is a " +
          "stability the earlier, noisier builds did not have. This is still one sample.";

    const contextRows = perFile.map((entry) => ({
        file: entry.file,
        kind: entry.kind,
        fileTokens: entry.runs[0].fileTokens,
        answerTokens: Math.round(entry.runs.reduce((s, r) => s + r.answerTokens, 0) / entry.runs.length)
    }));

    const baselineTotal = contextRows.reduce((s, r) => s + r.fileTokens, 0);
    const toolTotal = contextRows.reduce((s, r) => s + r.answerTokens, 0);

    const buggyRuns = ok.filter((r) => r.kind === "buggy");
    // The tolerance the harness grades with, restated here so the report can say
    // what it is rather than implying the hit count is exact.
    const LINE_TOLERANCE = 3;
    // Graded against the whole accepted set, matching `isExactLine` in
    // measure-file.mjs. A defect with two loci has two correct answers, and
    // grading against whichever anchor the corpus author typed first made a
    // model that switched between them read as a regression. Older result files
    // carry no `acceptableLines`, so they fall back to the planted line.
    const exactLine = buggyRuns.filter((r) =>
        (r.acceptableLines ?? [r.plantedLine]).includes(r.predictedLine)
    ).length;
    const cleanRuns = ok.filter((r) => r.kind === "clean");

    const sweep = [0.2, 0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 0.8].map((t) => ({
        t,
        found: buggyRuns.filter((r) => r.score >= t && r.outcome === "hit").length,
        falseAlarms: cleanRuns.filter((r) => r.score >= t).length
    }));
    const cleanCuts = sweep.filter((s) => s.falseAlarms === 0);
    const bestCut = cleanCuts.length > 0 ? cleanCuts.reduce((a, b) => (a.found >= b.found ? a : b)) : sweep.at(-1);

    // The break-even point: below it the answer costs more than the file.
    const meanAnswer = Math.round(toolTotal / contextRows.length);
    const cheaper = contextRows.filter((r) => r.answerTokens < r.fileTokens).length;

    /* ---- what changed since the previous build ---- */

    // Every figure on both sides comes out of a results file, so the comparison
    // cannot drift from what was measured. "Before" is bench/baseline.json,
    // extracted from the results committed at ${before.commit}.
    const noiseCeiling = Math.max(...cleanRuns.map((r) => r.score ?? 0));
    // How much noise there is to filter, before any threshold is applied. When
    // this is zero the prompt is doing the work and the gate is only a backstop.
    const cleanNamed = cleanRuns.filter((r) => (r.score ?? 0) > 0).length;
    const findings = buggyRuns.filter((r) => (r.score ?? 0) > 0).map((r) => r.score);
    const bugFloor = findings.length > 0 ? Math.min(...findings) : null;
    const cutHistory = before.fittedCutHistory.runs;
    const abOrderScore = ab.files.find((f) => !f.truth.defect)?.askTheTool.score ?? ab.gate;
    // The worst clean score seen in any recorded run, not just this one. A gate
    // fitted to a single sample sits on that sample's noise by construction.
    const worstNoise = Math.max(noiseCeiling, ...cutHistory.map((r) => r.noiseCeiling));
    // The lowest cut with no false alarms sits directly on the noise, which the
    // A/B in section 5 shows is not a safe place to stand. Recommend the next
    // step up instead.
    //
    // When nothing in the sweep clears the noise, there is no gate to recommend,
    // and saying so is the only honest option. Falling back to the top of the
    // sweep printed a number that did not do the job it was named for.
    const cleanEnough = sweep.find((s) => s.t > worstNoise && s.falseAlarms === 0);
    const recommendedCut = cleanEnough ?? bestCut;
    const gateClearsNoise = cleanEnough !== undefined;

    const abNow = {
        read: ab.arms.readTheFile.totalTokens,
        tool: ab.arms.askTheTool.totalTokens,
        readBugsFound: ab.files.filter((f) => f.truth.defect && f.readTheFile.correct).length,
        readFalseAlarms: ab.files.filter((f) => !f.truth.defect && !f.readTheFile.correct).length,
        bugsFound: ab.files.filter((f) => f.truth.defect && f.askTheTool.correct).length,
        bugsTotal: ab.files.filter((f) => f.truth.defect).length,
        falseAlarms: ab.files.filter((f) => !f.truth.defect && !f.askTheTool.correct).length,
        cleanTotal: ab.files.filter((f) => !f.truth.defect).length
    };

    /** Signed relative change, or an em dash when the before value is zero. */
    const rel = (from, to) =>
        from === 0 ? "n/a" : `${to >= from ? "+" : "−"}${dec(Math.abs((to - from) / from) * 100, 0)}%`;
    const abs = (from, to) => (to === from ? "no change" : `${to > from ? "+" : "−"}${Math.abs(to - from)}`);

    const changedRows = [
        ["Answer size, mean tokens per call", fmt(before.perFile.meanAnswerTokens), fmt(meanAnswer),
            rel(before.perFile.meanAnswerTokens, meanAnswer)],
        [`Context to ask about all ${contextRows.length} files`,
            `${fmt(before.perFile.toolTokens)} (${pct(before.perFile.toolTokens / before.perFile.baselineTokens)})`,
            `${fmt(toolTotal)} (${pct(toolTotal / baselineTotal)})`,
            rel(before.perFile.toolTokens, toolTotal)],
        ["Files where asking beats reading",
            `${before.perFile.filesCheaperToAsk} of ${before.perFile.filesTotal}`,
            `${cheaper} of ${contextRows.length}`, abs(before.perFile.filesCheaperToAsk, cheaper)],
        [`\`scan_project\` output, ${project.corpus.files} files`, fmt(before.project.scanTokens),
            fmt(project.scan.outputTokens), rel(before.project.scanTokens, project.scan.outputTokens)],
        ["`scan_project` shortlist, limit 10", fmt(before.project.shortlistTokens),
            fmt(project.scan.shortlistTokens), rel(before.project.shortlistTokens, project.scan.shortlistTokens)],
        [`Where the ${project.corpus.bugs} bugs rank in the scan`,
            before.project.bugRanks.join(", "), project.bugRanks.map((b) => b.rank).sort((a, b) => a - b).join(", "), "n/a"],
        ["Bugs inside the first 15 files",
            `${before.project.budgets.find((b) => b.k === 15).riskOrder} of ${project.corpus.bugs}`,
            `${project.budgets.find((b) => b.k === 15).riskOrder.found} of ${project.corpus.bugs}`,
            abs(before.project.budgets.find((b) => b.k === 15).riskOrder,
                project.budgets.find((b) => b.k === 15).riskOrder.found)],
        ["ρ between the ranking score and file size", String(before.project.sizeCorrelation),
            String(project.densitySizeCorrelation), "n/a"],
        ["Trials landing in the defect's function",
            `${before.perFile.hit} of ${before.perFile.buggyRuns}`,
            `${summary.buggy.hit} of ${buggyRuns.length}`, abs(before.perFile.hit, summary.buggy.hit)],
        ["Buggy files reported clean",
            `${before.perFile.missed} of ${before.perFile.buggyRuns}`,
            `${summary.buggy.missed} of ${buggyRuns.length}`, abs(before.perFile.missed, summary.buggy.missed)],
        ["False alarms on clean code, raw output",
            `${before.perFile.falsePositives} of ${before.perFile.cleanRuns}`,
            `${summary.clean.falsePositive} of ${cleanRuns.length}`,
            abs(before.perFile.falsePositives, summary.clean.falsePositive)],
        ["A/B: tokens spent by the tool-using agent", fmt(before.ab.askTheToolTokens), fmt(abNow.tool),
            rel(before.ab.askTheToolTokens, abNow.tool)],
        ["A/B: saving against the reading agent",
            pct(1 - before.ab.askTheToolTokens / before.ab.readTheFileTokens),
            pct(1 - abNow.tool / abNow.read), "n/a"],
        ["A/B: false alarms from the tool-using agent",
            `${before.ab.falseAlarms} of ${before.ab.cleanTotal}`,
            `${abNow.falseAlarms} of ${abNow.cleanTotal}`, abs(before.ab.falseAlarms, abNow.falseAlarms)]
    ];

    const separationRows = summary.separation
        ? [
              ["`score`, the model verdict", dec(before.perFile.separation.aiScore, 3),
                  dec(summary.separation.aiScore, 3), "n/a"],
              ["`combinedScore`, the reported score", dec(before.perFile.separation.combinedScore, 3),
                  dec(summary.separation.combinedScore, 3), "n/a"],
              ["`riskScore`, static complexity", dec(before.perFile.separation.staticRisk, 3),
                  dec(summary.separation.staticRisk, 3), "n/a"]
          ]
        : [];

    /* ---- typescript corpus ---- */

    const tsSummary = ts.summary;
    const tsOk = ts.runs.filter((r) => !r.error);
    const tsRuns = {
        buggy: tsOk.filter((r) => r.kind === "buggy").length,
        clean: tsOk.filter((r) => r.kind === "clean").length
    };
    const tsInCatalogue = tsManifest.bugs.filter((b) => b.inCatalogue).length;
    const tsOutside = tsManifest.bugs.length - tsInCatalogue;

    const tsPerFileMap = new Map();
    for (const run of tsOk) {
        if (!tsPerFileMap.has(run.file)) {
            tsPerFileMap.set(run.file, {
                file: run.file,
                kind: run.kind,
                plantedLine: run.plantedLine,
                runs: []
            });
        }
        tsPerFileMap.get(run.file).runs.push(run);
    }
    const tsPerFile = [...tsPerFileMap.values()].sort(
        (a, b) => (a.kind === b.kind ? 0 : a.kind === "buggy" ? -1 : 1)
    );

    // How often the escape hatch was reached for, and at what confidence. If it
    // ever starts appearing on clean files it has become a dumping ground.
    // Named findings on files the key calls clean. Kept in the count, quoted in
    // the prose: a corpus whose controls are rewritten whenever the tool objects
    // scores perfectly by construction.
    const tsFalseAlarms = tsOk.filter((r) => r.kind === "clean" && (r.score ?? 0) > 0);
    const tsOtherScores = tsOk.filter((r) => r.predictedPattern === "other").map((r) => r.score);
    const tsOtherRuns = tsOtherScores.length;
    const tsOtherRange = tsOtherRuns === 0
        ? ["n/a", "n/a"]
        : [Math.min(...tsOtherScores), Math.max(...tsOtherScores)];

    /* ---- provider comparison ---- */

    // Two providers, the same corpus, the same prompt. They fail in opposite
    // directions, which is the point of charting them together rather than
    // reporting whichever one looks best.
    const providerRow = (results) => ({
        label: results.summary.provider.replace(/^./, (ch) => ch.toUpperCase()),
        buggyRuns: results.summary.buggy.runs,
        cleanRuns: results.summary.clean.runs,
        rawHits: results.summary.buggy.hit,
        rawFalseAlarms: results.summary.clean.falsePositive,
        gatedHits: results.summary.actionable?.buggy.hit ?? results.summary.buggy.hit,
        gatedFalseAlarms: results.summary.actionable?.clean.falsePositive ?? results.summary.clean.falsePositive,
        gate: results.summary.actionable?.threshold ?? null,
        meanMsPerFile: results.summary.latency.meanMsPerFile,
        separation: results.summary.separation?.aiScore ?? null
    });
    const providerRows = [providerRow(file), providerRow(precision)];

    const mostHits = [...providerRows].sort((a, b) => b.gatedHits - a.gatedHits)[0];
    const fewestAlarms = [...providerRows].sort((a, b) => a.gatedFalseAlarms - b.gatedFalseAlarms)[0];
    const providerVerdict =
        mostHits.label === fewestAlarms.label
            ? `**${mostHits.label} wins on both counts** in this run. It finds ${mostHits.gatedHits} of ` +
              `${mostHits.buggyRuns} planted lines at the gate and ${mostHits.gatedFalseAlarms} of ` +
              `${mostHits.cleanRuns} false alarms. One run per provider is not enough to call that a ` +
              "property of the models rather than of this corpus."
            : `They trade off against each other. **${mostHits.label}** finds more, ` +
              `${mostHits.gatedHits} of ${mostHits.buggyRuns} planted lines at the gate against ` +
              `${fewestAlarms.gatedHits}. **${fewestAlarms.label}** is quieter, at ` +
              `${fewestAlarms.gatedFalseAlarms} false alarms against ${mostHits.gatedFalseAlarms}. ` +
              "Which one is right for an agent depends on whether a missed defect or a wasted " +
              "investigation costs more, and one run per provider is not enough to settle it.";

    /* ---- charts ---- */

    const contextImg = await emit(
        "context",
        (c) => contextSpec(contextRows, c),
        "Tokens used per file: reading the file versus asking predict_failures"
    );

    const outcomeImg = await emit(
        "outcomes",
        (c) => outcomeSpec(perFile, summary.trials, c),
        "Outcome by file and trial: whether the tool named the planted line"
    );

    const scoreImg = await emit(
        "scores",
        (c) => scoreSpec(ok, recommendedCut.t, c),
        "Score distribution for buggy and clean files, with the actionable gate"
    );

    const budgetImg = await emit(
        "budget",
        (c) => budgetSpec(project.budgets, project.corpus.bugs, c),
        "Bugs found at the same file budget using three orderings"
    );

    const providerImg = await emit(
        "providers",
        (c) => providerSpec(providerRows, c),
        "Planted lines found and false alarms raised, per provider, raw and after the gate"
    );

    /* ---- document ---- */

    const md = `# Benchmark results

Does \`predict_failures\` save context for a calling agent, and is its answer
trustworthy enough to act on without reading the file?

In plain terms: we took ${perFile.length} small JavaScript files — ${perFile.filter((f) => f.kind === "buggy").length} with a bug deliberately
planted in them, ${perFile.filter((f) => f.kind === "clean").length} written clean on purpose — and asked the tool to find the
bug in each, ${summary.trials} separate times per file. We never told it which files were
buggy. The question this answers is whether its guess is worth trusting, and
whether asking costs less than reading the file yourself would have.

Corpus: ${project.corpus.files} generated files with ${project.corpus.bugs} planted bugs.
The per-file test above covers ${perFile.length} of them: ${perFile.filter((f) => f.kind === "buggy").length} buggy files and
${perFile.filter((f) => f.kind === "clean").length} clean controls, ${summary.trials} trials each, using the \`${summary.provider}\` CLI. A
larger, separate result further down covers ranking a whole project instead of
one file at a time.

## How to read the numbers below

| Term | Meaning |
|---|---|
| Trial | One independent model call on one file. Each file gets ${summary.trials} trials. |
| Hit | The prediction lands inside the function the planted defect is in. |
| Wrong location | The model names a defect, but outside that function. |
| False alarm | The model names a defect in a clean control file — the wrong answer that matters most, since it's what would make someone stop trusting the tool. |
| Raw finding | What the model returned before the product applies its confidence rule. |
| Actionable | A named finding scored ≥ ${recommendedCut.t} — confident enough that VS Code adds it to Problems. |
| AUC | How cleanly the score separates buggy files from clean ones, from 0.5 (no better than a coin flip) to 1.0 (perfect separation). |

## Bottom line

| Question | Measured answer |
|---|---|
| Does the tool reduce context? | Yes. ${fmt(toolTotal)} tokens instead of ${fmt(baselineTotal)}, ${pct(1 - toolTotal / baselineTotal)} less file content. |
| Does it point to the planted line? | ${summary.buggy.hit} of ${buggyRuns.length} bug trials land inside the defect's own function, ${exactLine} of ${buggyRuns.length} on the exact line. ${summary.buggy.wrongLocation} pointed elsewhere. |
| Does it accuse clean files? | ${cleanNamed} of ${cleanRuns.length} raw trials${gateClearsNoise ? `, ${recommendedCut.falseAlarms} after the ${recommendedCut.t} gate` : ", and no tested gate removes them"}. |
| Does it help a real agent? | ${pct(1 - abNow.tool / abNow.read)} fewer tokens in the A/B. Both arms found ${abNow.bugsFound} of ${abNow.bugsTotal} bugs. |
| Does project ranking help? | At 15 files, risk order contains ${project.budgets.find((b) => b.k === 15).riskOrder.found} of ${project.corpus.bugs} bugs. Directory order contains ${project.budgets.find((b) => b.k === 15).directoryOrder.found}. |
| What does one prediction cost in time? | ${dec(summary.latency.meanMsPerFile / 1000)} s mean, ${dec(summary.latency.maxMs / 1000)} s worst. |

${cleanNamed === 0 ? "This run has a clean precision result. No clean control received a defect." : `${cleanNamed} of ${cleanRuns.length} clean trials named a defect, ${recommendedCut.falseAlarms} of them above the gate.`}
${
    summary.buggy.wrongLocation === 0
        ? "Every prediction landed inside the function containing the defect."
        : `Localisation is the weakness: ${summary.buggy.wrongLocation} of ${buggyRuns.length} bug trials found a real-looking issue outside the defect's function.`
} The tool saves context, but the extra model call means it did not make the A/B faster.

Two numbers are given for localisation because they answer different questions, and an
agent and a Problems panel need different ones. **${summary.buggy.hit} of
${buggyRuns.length} predictions land inside the function the defect is in**, which is what
an agent needs to know where to look. **${exactLine} of ${buggyRuns.length} land on the
line itself**, which is what a panel that underlines one line needs.

Grading by the enclosing function replaced a tolerance of three lines either way. That
tolerance measured the wrong thing in both directions: on \`lib/retry.js\`, 13 lines long, it
accepted most of the file, so a prediction fell inside it by luck; and on a defect with two
defensible sites it called a correct answer a miss. \`lib/retry.js\` is the example of the
second. The defect swallows an error so the function resolves undefined, the key names the
\`catch\`, and the model names the fall-through four lines later. Both are the defect.

The five charts below are embedded from \`bench/charts\`. Each caption states what to look
for, and the link below each chart opens the SVG at full size.

## Visual summary

### Context used per file

${contextImg}

Each pair of bars compares reading the whole file with calling \`predict_failures\`.
The tool uses less context on ${cheaper} of ${contextRows.length} files. It costs more on
the smallest files because the answer itself is longer than the source.

### Result of every trial

${outcomeImg}

Rows are files and columns are trials. The chart shows ${summary.buggy.hit} correct-line
hits, ${summary.buggy.wrongLocation} wrong locations, and ${cleanRuns.length} correctly
clean control trials.

### Score separation

${scoreImg}

The horizontal position is the model score from 0 to 1. Clean trials sit at 0 in this
run. Findings on buggy files start at ${bugFloor}. The vertical marker is the
${recommendedCut.t} actionable gate.

### Claude and Codex

${providerImg}

This chart compares raw and gated results under the same prompt. Claude hit ${providerRows.find((p) => p.label === "Claude").gatedHits}
of ${providerRows.find((p) => p.label === "Claude").buggyRuns} planted lines. Codex hit
${providerRows.find((p) => p.label === "Codex").gatedHits} of ${providerRows.find((p) => p.label === "Codex").buggyRuns}.
Neither provider raised a gated false alarm in these runs.

### Bugs found within a file budget

${budgetImg}

The x-axis is the number of files an agent reads. The y-axis is planted bugs included.
At 15 files, risk-density order reaches ${project.budgets.find((b) => b.k === 15).riskOrder.found} bugs.
Directory order reaches ${project.budgets.find((b) => b.k === 15).directoryOrder.found}, and random order is expected
to reach ${project.budgets.find((b) => b.k === 15).randomExpected}.

## Why false alarms dropped

The default product behaviour now applies the 0.70 gate itself. Low-confidence model
hypotheses remain available as raw evidence, but they no longer become VS Code Problems;
\`predict_failures\` returns an explicit \`actionable\` boolean and a four-state \`status\`.
An \`uncertain\` result keeps its pattern, score, line and reason, but is labelled "not added
to Problems"; agents are told to report a defect only when \`actionable\` is true. The
classifier prompt also rejects failures that require an
invented malformed input, dependency-contract violation, or ordinary error propagation.

This is an exact replay of the same ${before.precisionTuningBefore.buggyRuns + before.precisionTuningBefore.cleanRuns}
Claude responses from immediately before the precision change, so the comparison has no
provider or sampling variance:

${table(
    ["User-visible result", "Before", "After", "Change"],
    [
        ["False Problems on clean code",
            `${before.precisionTuningBefore.problemsPanelFalsePositives} of ${before.precisionTuningBefore.cleanRuns}`,
            `0 of ${before.precisionTuningBefore.cleanRuns}`,
            `−${before.precisionTuningBefore.problemsPanelFalsePositives}`],
        ["Planted lines surfaced as actionable",
            `${before.precisionTuningBefore.rawHits} of ${before.precisionTuningBefore.buggyRuns}`,
            `${before.precisionTuningBefore.actionableHitsAt070} of ${before.precisionTuningBefore.buggyRuns}`,
            `−${before.precisionTuningBefore.rawHits - before.precisionTuningBefore.actionableHitsAt070}`],
        ["Machine-readable MCP decision", "none", "\`status\` + \`actionable\`", "added"]
    ]
)}

That replay measured the reporting gate alone, holding the model output fixed. The
provider-matched Claude rerun has since been done. It measures the other half: what
the evidence policy does to the model's answers rather than to their presentation. It is
the run behind every other number in this file:

${table(
    [`Claude, ${summary.trials} trials per file`, "Old prompt, replayed", "Evidence policy, fresh run", "Change"],
    [
        ["Clean trials naming any defect",
            `${before.precisionTuningBefore.rawFalsePositives} of ${before.precisionTuningBefore.cleanRuns}`,
            `${cleanNamed} of ${cleanRuns.length}`,
            abs(before.precisionTuningBefore.rawFalsePositives, cleanNamed)],
        ["Planted lines named, raw",
            `${before.precisionTuningBefore.rawHits} of ${before.precisionTuningBefore.buggyRuns}`,
            `${summary.buggy.hit} of ${buggyRuns.length}`,
            abs(before.precisionTuningBefore.rawHits, summary.buggy.hit)],
        ["Buggy files reported clean",
            `${before.precisionTuningBefore.buggyRuns - before.precisionTuningBefore.rawHits} of ${before.precisionTuningBefore.buggyRuns}`,
            `${summary.buggy.missed} of ${buggyRuns.length}`,
            abs(before.precisionTuningBefore.buggyRuns - before.precisionTuningBefore.rawHits, summary.buggy.missed)]
    ]
)}

The false alarms are gone at the source. The first version of the policy took the race
condition in \`workers/reconciliationWorker.js\` with it. The model reported it clean in all
${summary.trials} trials, because "state read and later
overwritten across an await" is exactly the kind of claim the policy asks the model to
disprove first, and a single sequential reading of the file disproves it.

The fix was to say that concurrency is not an invented input: anything on a timer, in a
polling loop, or exported as a service method can be entered again before an earlier call
finishes, unless the source shows it cannot. That is one clause, and it costs no precision:

${table(
    [`Claude, ${summary.trials} trials per file`, "Evidence policy", "…plus the concurrency clause", "Change"],
    [
        ["Clean trials naming any defect",
            `${before.concurrencyClauseBefore.rawFalsePositives} of ${before.concurrencyClauseBefore.cleanRuns}`,
            `${cleanNamed} of ${cleanRuns.length}`,
            abs(before.concurrencyClauseBefore.rawFalsePositives, cleanNamed)],
        ["Planted lines named",
            `${before.concurrencyClauseBefore.rawHits} of ${before.concurrencyClauseBefore.buggyRuns}`,
            `${summary.buggy.hit} of ${buggyRuns.length}`,
            abs(before.concurrencyClauseBefore.rawHits, summary.buggy.hit)],
        ["Buggy files reported clean",
            `${before.concurrencyClauseBefore.missed} of ${before.concurrencyClauseBefore.buggyRuns}`,
            `${summary.buggy.missed} of ${buggyRuns.length}`,
            abs(before.concurrencyClauseBefore.missed, summary.buggy.missed)],
        ["Separation (AUC)",
            dec(before.concurrencyClauseBefore.separation.aiScore, 3),
            dec(summary.separation.aiScore, 3),
            "n/a"],
        ["Latency per file",
            `${dec(before.concurrencyClauseBefore.meanMsPerFile / 1000)} s`,
            `${dec(summary.latency.meanMsPerFile / 1000)} s`,
            rel(before.concurrencyClauseBefore.meanMsPerFile, summary.latency.meanMsPerFile)]
    ]
)}

Nothing is reported clean any more, and no clean file is accused.${
    summary.buggy.wrongLocation === 0
        ? ""
        : ` ${summary.buggy.wrongLocation} of ${buggyRuns.length} buggy runs named a
real-looking issue outside the defect's function — see the per-file table below for which.`
} Latency rose because the model reasons for longer. The
worst single call took ${dec(summary.latency.maxMs / 1000)} s.

Section 4 puts the two providers side by side on the same policy.

## Historical comparison

<details>
<summary>Open the full before/after history</summary>

This section tracks the route from the first benchmark to the current build. Skip it if
you only need the current result. \`scan_project\` ranks by
risk density rather than total risk, \`combinedScore\` weights the model verdict at 0.9
instead of 0.4, both tools return a much smaller payload, and the classifier prompt gained
an evidence policy and a concurrency clause. Both columns come from result files:
\`baseline.json\` for the left, the current \`results.json\` and \`results-file.json\` for the
right. This keeps both sides tied to measured data.

${table(["Measure", "Before", "After", "Change"], changedRows)}
${separationRows.length === 0 ? "" : `
Separation is the probability that a run on a buggy file scores above a run on a clean
one, ties counted as half. 0.5 is a coin toss; below 0.5 the number is pointing the wrong
way. This is the question "which score should an agent gate on", answered rather than
assumed:

${table(["Score", "Before", "After", "Change"], separationRows)}

The static complexity score is worse than chance at telling a buggy file from a clean one,
and the old blend gave it 0.4 of the vote. That is the entire reason \`combinedScore\`
moved.`}

The comparison also exposes three limits:

- **What fixed the false alarms was the prompt, not the threshold.** The lowest cut with no
  false alarms came out at ${cutHistory.map((r) => r.fittedCut).join(", ")} across
  ${cutHistory.length} runs of the same ${cleanRuns.length} clean trials on the same corpus.
  For the first three that number was pinned to wherever the noise stopped, and section 5
  shows an agent given ${ab.gate}, the fitted minimum at the time, reporting a defect in a
  clean file that scored exactly ${ab.gate}. The gate is now a backstop worth keeping at
  ≥ ${recommendedCut.t}, not the mechanism.
- **Precision was bought with recall, and the corpus cannot price that trade.** Naming the
  planted line went from ${before.perFile.hit} of ${before.perFile.buggyRuns} to
  ${summary.buggy.hit}, and latency per file from
  ${dec(before.perFile.meanMsPerFile / 1000)} s to ${dec(summary.latency.meanMsPerFile / 1000)} s.
  Whether a wasted investigation costs more than a missed defect is a question about the
  person reading the output, not about this benchmark.
- **The smallest files still cost more to ask about than to read**, and always will: an
  ${Math.min(...contextRows.map((r) => r.fileTokens))}-token file cannot be described in
  fewer tokens than it contains.

</details>

## Detailed results

### 1. Context cost: cheaper on ${cheaper} of ${contextRows.length} files

The answer costs roughly the same regardless of file size: ${meanAnswer} tokens on
average. It contains one line number, one pattern, one rationale and two scores.
The metric block and the log stanza are behind a \`verbose\` flag, and the path is
echoed as given rather than resolved; before that they were four fifths of the reply.
This creates a break-even point: the tool is cheaper only for files above roughly
${meanAnswer} tokens, which is ${cheaper} of the ${contextRows.length} files here. ${breakEvenNote}

${table(
    ["File", "Type", "Read the file", "Ask the tool", "Context change"],
    contextRows.map((r) => [
        `\`${r.file.replace(/^src\//, "")}\``,
        r.kind === "buggy" ? "bug" : "clean",
        fmt(r.fileTokens),
        fmt(r.answerTokens),
        `${r.answerTokens < r.fileTokens ? "Saves" : "Costs"} ${fmt(Math.abs(r.fileTokens - r.answerTokens))}`
    ])
)}

### 2. Accuracy: ${summary.buggy.hit} correct lines and ${summary.buggy.wrongLocation} wrong locations

The savings matter only if the agent can trust the answer without reading the file
anyway. The clean files are the control group: they measure whether the tool invents
defects that are not there.

Each trial is an independent model call on the same file. **Hit** means the predicted
line is inside the function the planted defect is in. **False alarm** means the model named a
defect in a clean control. **Correctly clean** means it found none; a low-confidence guess
can also be correctly suppressed. **Missed** and **wrong location** apply only to files
with a planted bug. This table grades the raw model reply; the 0.70 product gate determines
whether it becomes an actionable Problem.

${table(
    [
        "File",
        "Expected",
        "Planted line",
        ...Array.from({ length: summary.trials }, (_, i) => `Trial ${i + 1}`)
    ],
    perFile.map((entry) => [
        `\`${entry.file.replace(/^src\//, "")}\``,
        entry.kind === "buggy" ? "Bug" : "Clean",
        entry.plantedLine ?? "Not applicable",
        ...entry.runs.map(outcomeText)
    ])
)}

### 3. Confidence: clean and buggy scores do not overlap

${
    cleanNamed === 0
        ? "This section used to carry the precision result. Clean files drew true but generic remarks such as " +
          '*"`rows.map` assumes that `db.query` always returns an array"*. The score was the only ' +
          "thing standing between those and the Problems panel. The evidence policy in the prompt now " +
          "refuses them at the source, so there is nothing left here for a threshold to filter."
        : "The false alarms above are not fabricated. They are true but generic, for example " +
          '*"`rows.map` assumes that `db.query` always returns an array"*. The question is whether the ' +
          "score can filter them out."
}

${table(
    ["Threshold", "Bugs found", "False alarms"],
    sweep.map((s) => [
        String(s.t),
        `${s.found} of ${buggyRuns.length}`,
        `${s.falseAlarms} of ${cleanRuns.length}`
    ])
)}

${
    cleanNamed === 0
        ? `Every column is the same, because there is nothing to trade. Every clean trial scored 0, and ` +
          `every finding on a buggy file scored at least ${bugFloor}. The gap runs from ` +
          `0 to ${bugFloor}, with no run of either kind inside it. Any gate in that range gives ` +
          `identical results, which means the threshold is currently free and currently useless.`
        : `The lowest cut with a clean sweep on this run is **${bestCut.t}**, where the tool finds ` +
          `${bestCut.found} of ${buggyRuns.length} planted bugs with ${bestCut.falseAlarms} false alarms.`
}

${
    !gateClearsNoise
        ? `**No threshold in the sweep separates this run.** A clean control reached ` +
          `${noiseCeiling}, above every cut tested, so there is no number to recommend and quoting ` +
          `one would be a fiction. The gate shipped in \`confidence.ts\` stays at 0.70 because it is ` +
          `the value the other runs support, not because this run endorses it. See the caveats for ` +
          `what that clean control actually contains.`
        : cleanNamed === 0
          ? `**Keep the gate at ≥ ${recommendedCut.t} anyway.** It costs nothing on this run and it is ` +
            `the only thing standing between a change in model behaviour and the Problems panel. The ` +
            `refusal is a model behaviour, not a guarantee: the same corpus produced clean-file scores ` +
            `as high as ${worstNoise} on earlier builds, and the independent run in section 5 saw one ` +
            `reach ${abOrderScore}.`
          : `**Keep the gate at ≥ ${recommendedCut.t}.** It is a step above ${worstNoise}, the highest ` +
            `score a clean file has reached in any run recorded here, and it costs ` +
            `${bestCut.found - recommendedCut.found} of the ${buggyRuns.length} buggy runs.`
}

The lowest cut with no false alarms has come out at
${cutHistory.map((r) => r.fittedCut).join(", ")} across ${cutHistory.length} runs of these same
${cleanRuns.length} clean trials. For the first three it was pinned to wherever the noise
happened to stop that run, which is not a property of the tool.

> **A threshold fitted on the trials used to evaluate it proves nothing.** Section 5 is the
> demonstration: a cut that swept clean here failed on the first four unseen files it met.
> What changed the result was the prompt, not the number. That is still measured on one
> corpus the policy was written against.

### 4. TypeScript: ${tsSummary.buggy.hit} of ${tsRuns.buggy} planted lines, ${tsSummary.clean.falsePositive} of ${tsRuns.clean} false alarms

Every other number in this file is JavaScript. This one is not, and it exists because
"TypeScript is supported" was an assertion for as long as the corpus had no TypeScript in
it.

The corpus is ${tsManifest.fileCount} hand-written files: ${tsManifest.controls.length} clean
controls and ${tsManifest.bugs.length} defects. It is written out literally rather than
assembled from templates, because the JavaScript generator's template cycling is the defect
this benchmark has caught twice. ${tsInCatalogue} of the defects are in the tool's pattern
catalogue and ${tsOutside} were planted deliberately outside it. The controls carry the
syntax the analyser used to reject: decorated Nest and TypeORM classes, generics, an
\`.mts\` module, and one method long enough to make \`longFunctions\` fire, which had never
happened once across the ${project.corpus.files} files of the JavaScript corpus.

${table(
    ["File", "Expected", "Trial 1", "Trial 2", "Trial 3"],
    tsPerFile.map((entry) => [
        `\`${entry.file.replace(/^src\//, "")}\``,
        entry.kind === "buggy" ? `Defect, line ${entry.plantedLine}` : "Clean",
        ...entry.runs.map((run) => outcomeText(run))
    ])
)}

**A closed list of pattern ids was throwing away correct answers.** Before this run the
catalogue offered six ids or \`none\`, and \`parsePrediction\` forces the score to 0 whenever
the pattern is \`none\`. Asked about \`sync.service.ts\`, whose \`modifiedSince\` filters on
\`createdAt\` while its own documentation promises every record edited since a timestamp, the
model named line 16 and explained the contradiction exactly. Then it answered \`none\`,
because no id fitted, and the finding was discarded. That happened on every trial of both
defects planted outside the catalogue: five of fifteen buggy runs, correct and thrown away.

Adding an \`other\` id fixed it. \`none\` now means no defect; \`other\` means a defect that is
not one of the six. The bar is unchanged, and the evidence policy still applies. Across this
run \`other\` was used ${tsOtherRuns} times, never on a clean file, at scores from
${tsOtherRange[0]} to ${tsOtherRange[1]}.

> **This corpus was tuned against this tool, in the same week, by the same author.** Two
> controls were rewritten because the tool flagged them, and the \`other\` id was added after
> seeing which runs it failed. That is fitting on the test set, and the perfect score should
> be read as "no known failure mode is left in a corpus built to expose them", not as a
> measure of TypeScript quality. The held-out evidence is section 2: JavaScript never
> motivated the \`other\` change and can show whether it cost anything there.

${tsFalseAlarms.length === 0 ? "" : `**The ${tsFalseAlarms.length === 1 ? "one false alarm is" : `${tsFalseAlarms.length} false alarms are`} disputed, and the answer key wins anyway.** On
\`${tsFalseAlarms[0].file.replace(/^src\//, "")}\` the model wrote: *"${tsFalseAlarms[0].reason}"* That is
arguable rather than wrong. The control was written by hand and the objection is real, so the
honest options were to rewrite the file or to let the alarm stand. Three controls have already
been rewritten because the tool flagged them, and rewriting every control it complains about
guarantees a perfect score by construction. The count stays.

`}**One defect was not planted.** \`invoice.entity.ts\` was written as a clean control. A
nullable TypeORM column arrives as \`null\` rather than \`undefined\`, and \`isSettled()\`
compared against \`undefined\`, so every unsettled invoice reported as settled. The tool
found it on all three trials at scores from 0.72 to 0.78. It is now in the answer key marked
\`discovered\`, and it is the reason a hand-written control group is worth re-reading rather
than trusting.

### 5. Providers: Claude found more planted lines in this run

The same corpus, prompt and gate went through each provider's CLI once.
They do not fail the same way, and picking whichever one looks better would hide that.

${table(
    ["Provider", "Planted lines, raw", "Planted lines, gated", "False alarms, raw", "False alarms, gated", "Separation", "Latency"],
    providerRows.map((p) => [
        `\`${p.label.toLowerCase()}\``,
        `${p.rawHits} of ${p.buggyRuns}`,
        `${p.gatedHits} of ${p.buggyRuns}`,
        `${p.rawFalseAlarms} of ${p.cleanRuns}`,
        `${p.gatedFalseAlarms} of ${p.cleanRuns}`,
        p.separation === null ? "n/a" : String(p.separation),
        `${dec(p.meanMsPerFile / 1000)} s`
    ])
)}

${providerVerdict}

Separation is the probability that a run on a buggy file scores above a run on a clean
one, with ties counted as half. A value of 0.5 is chance. It is a fairer comparison than either
column of counts, because it does not depend on where the gate happens to sit.

### 6. Agent A/B: ${pct(1 - abNow.tool / abNow.read)} fewer tokens and the same number of bugs

Two agents, the same four files, and the same task. One had to read the files; the other
could only call \`predict_failures\` and act on the \`actionable\` flag the tool returns.
Neither was told which files contained bugs.

${ab.measuredAgainst}

${table(
    ["Measure", "Without tool: reads files", "With tool: calls predict_failures"],
    [
        ["Total tokens used", fmt(ab.arms.readTheFile.totalTokens), `**${fmt(ab.arms.askTheTool.totalTokens)}**`],
        ["Time", `${dec(ab.arms.readTheFile.durationMs / 1000)} s`, `**${dec(ab.arms.askTheTool.durationMs / 1000)} s**`],
        ["Source lines read", fmt(ab.arms.readTheFile.linesRead), fmt(ab.arms.askTheTool.linesRead)],
        ["Bugs found", `${abNow.readBugsFound} of ${abNow.bugsTotal}`, `${abNow.bugsFound} of ${abNow.bugsTotal}`],
        ["False alarms", `${abNow.readFalseAlarms} of ${abNow.cleanTotal}`, `${abNow.falseAlarms} of ${abNow.cleanTotal}`]
    ]
)}

The tool-using agent spent ${pct(1 - abNow.tool / abNow.read)} fewer tokens, read no source
at all, and ${
    Math.abs(1 - ab.arms.askTheTool.durationMs / ab.arms.readTheFile.durationMs) < 0.05
        ? "took the same wall-clock time. The tool's model call costs roughly what reading four files costs"
        : ab.arms.askTheTool.durationMs < ab.arms.readTheFile.durationMs
          ? `finished ${pct(1 - ab.arms.askTheTool.durationMs / ab.arms.readTheFile.durationMs)} sooner`
          : `took ${pct(ab.arms.askTheTool.durationMs / ab.arms.readTheFile.durationMs - 1)} longer`
}. It found ${abNow.bugsFound === abNow.readBugsFound ? "the same number of bugs" : "a different number of bugs"}, and ${
    abNow.falseAlarms === abNow.readFalseAlarms
        ? "the two arms raised the same number of false alarms"
        : abNow.falseAlarms < abNow.readFalseAlarms
          ? "it was the arm that did **not** invent a defect in the clean control"
          : "it was the arm that invented a defect in the clean control"
}.

${table(
    ["File", "Ground truth", "Without the tool", "With the tool"],
    ab.files.map((f) => [
        `\`${f.file.replace(/^src\//, "")}\``,
        f.truth.defect ? `bug, line ${f.truth.line}` : "clean",
        f.readTheFile.defect
            ? `Line ${f.readTheFile.line}, ${f.readTheFile.correct ? "correct" : "wrong location"}`
            : `No finding, ${f.readTheFile.correct ? "correct" : "missed"}`,
        f.askTheTool.defect
            ? `Line ${f.askTheTool.line}, ${f.askTheTool.correct ? "correct" : "wrong location"}`
            : `No finding, ${f.askTheTool.correct ? "correct" : "missed"} (score ${f.askTheTool.score})`
    ])
)}

The saving here is much smaller: ${pct(1 - abNow.tool / abNow.read)} versus
${pct(1 - toolTotal / baselineTotal)} in section 1. The difference is the agent's own
overhead: its system prompt, reasoning, and response dominate, while file content is
only part of the bill. **Section 1 measures savings on file content; section 5 measures
the savings in practice.**

The A/B exposed three details that the totals hide:

- **The arms have swapped places on the clean file.** The last A/B, run before the evidence
  policy and with a numeric gate fitted on that day's trials, had the tool reporting a defect
  in \`orderService.js\` and the reading agent clearing it. This time the tool scored it
  ${ab.files.find((f) => !f.truth.defect).askTheTool.score} and returned \`status: none\`,
  noting that the duplicate method definitions are functionally equivalent and so not an
  observable defect. The reading agent reported a defect at line
  ${ab.files.find((f) => !f.truth.defect).readTheFile.line}. Reading the code is not a
  precision baseline that a tool has to catch up to.
- **That false alarm is the more interesting half.** The reading agent argued that
  \`repo.loadBatch\` returns a single object rather than an array, which is a real
  inconsistency in the generated corpus. \`pricingService.js\` does treat the same call as an
  object. The answer key says the file is clean, so it scores as a false alarm, and that is
  the right call for this benchmark. It is also a reminder that the key is only as good as
  the generator (see caveats).
- **\`reconciliationWorker.js\` splits the arms.** The reading agent concluded the arithmetic
  was consistent and reported nothing. The tool described the planted defect in words: the
  balance read before the awaits, overwritten after them. It pointed at line
  ${ab.files.find((f) => f.file.includes("reconciliation")).askTheTool.line}, which is the
  write, while the key names line ${ab.files.find((f) => f.file.includes("reconciliation")).truth.line},
  the read. Both are inside \`tick\` and both are the defect, which is the case that retired
  the line tolerance in favour of grading by enclosing function. This A/B predates that
  change and is scored under the old rule.

### 7. Project ranking: ${project.budgets.find((b) => b.k === 15).riskOrder.found} of ${project.corpus.bugs} bugs in the first 15 files

At the same budget of k files, how many of the ${project.corpus.bugs} bugs are included? Random ordering is the null hypothesis. With
${project.corpus.bugs} bugs spread over ${project.corpus.files} files, k files picked blind
contain ${pct(project.corpus.bugs / project.corpus.files)} of them on average.

${table(
    ["Budget", "Risk order", "Directory order", "Random (expected)"],
    project.budgets.map((b) => [
        `${b.k} files`,
        `${b.riskOrder.found} of ${project.corpus.bugs}`,
        `${b.directoryOrder.found} of ${project.corpus.bugs}`,
        String(b.randomExpected)
    ])
)}

The same question at an equal *token* budget, which is what the agent actually pays:

${table(
    ["Budget", "Risk order", "Directory order"],
    project.tokenBudgets.map((b) => [
        `${fmt(b.budget)} tokens`,
        `${b.riskOrder.found} of ${project.corpus.bugs} (${b.riskOrder.filesRead} files)`,
        `${b.directoryOrder.found} of ${project.corpus.bugs} (${b.directoryOrder.filesRead} files)`
    ])
)}

The ranking uses **risk density**, weighted signals per 100 lines, rather than the total.
Ranking by the total is close to ranking by size: its rank correlation with raw file
size is ρ = ${project.sizeCorrelation}, against ρ = ${project.densitySizeCorrelation}
for density. That distinction is the whole result here. Mutations, branches and
cyclomatic complexity accumulate in step with file length, so at full weight a per-line
score just measures how assignment-heavy a file is and puts plain row mappers on top;
they are damped to a tenth of their weight, and the signals that do not scale with
length. Nested loops, async boundaries, long functions and try/catch carry the order.

${bugRankSentence}

> **These weights were fitted on this corpus.** Six bugs is not enough to fit anything
> safely; what supports the change is that the improvement is monotone in how much the
> length-proportional signals are damped, not that one setting happened to win.

## Caveats

- **Tokens do not disappear; they move.** \`predict_failures\` spawns another model that
  reads the entire file. The saving is in the calling agent's *context window*, not total
  consumption. The cost is ${dec(summary.latency.meanMsPerFile / 1000)} s of latency per file.
- **The corpus is generated, and its generator has a defect.** Files with more than eight
  methods receive duplicate method names because the name generator cycles.
  \`orderService.js\` defines three methods twice. This makes the "clean" controls less
  clean than intended. The measurements stand, but the corpus is less realistic than it appears.
- **Bugs are placed per file, not per line.** Three are in large files and three in small
  files. That is deliberate, and it is why section 6 reports a token budget alongside a
  file budget: a per-file placement flatters any ranking that reads the big files first,
  and only the token budget shows what the agent actually pays.
- **The headline numbers are in-sample.** The JavaScript corpus and this tool were
  built by the same author in the same week, and the classifier prompt was revised in
  response to what the corpus showed: the evidence policy, the concurrency clause and
  the \`other\` pattern id were each added after seeing a specific failure here. The
  density weights in section 5 were fitted on these six bugs. Nothing in this file is a
  held-out measurement, so read it as a description of known failure modes and of what
  changed when, not as an estimate of how the tool will do on your repository.
- **The TypeScript corpus was built against this tool, in the same week, by the same
  author.** Two of its controls were rewritten because the tool flagged them, and the
  \`other\` pattern id was added after seeing which runs it failed. Section 4 is therefore
  a statement about known failure modes, not a measure of TypeScript quality. It is also
  ${tsManifest.fileCount} files against ${project.corpus.files} for JavaScript.
- **${summary.trials} trials per file, and two runs in the A/B test.** This is enough to
  show that the answer varies, not enough for a precise estimate. ${varianceNote}
- **Tokens are counted with cl100k BPE** (gpt-tokenizer), not Claude's tokenizer, except
  in section 5 where the figures come from the harness's own accounting. The ratios hold;
  the absolute figures in sections 1–3 are approximate.

## Run it yourself

\`\`\`bash
npm install                      # gpt-tokenizer and vega are devDependencies
npm run build                    # the bench drives dist/mcp-server.js
npm run bench                    # the JavaScript corpus, all four steps below
npm run bench:ts                 # the TypeScript corpus

node bench/generate-corpus.mjs   # corpus + answer key
node bench/measure.mjs           # project level
node bench/measure-file.mjs      # per file (real CLI calls; takes a few minutes)
node bench/markdown.mjs          # this file + charts
\`\`\`

Generated ${file.generatedAt}.
`;

    await fs.writeFile(path.join(here, "RESULTS.md"), md, "utf8");
    console.log("wrote bench/RESULTS.md and bench/charts/*.svg");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
