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
    standalone,
    svgLegend,
    contextChart,
    outcomeChart,
    scoreStrip,
    budgetChart
} from "./charts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const chartDir = path.join(here, "charts");

const read = async (name) => JSON.parse(await fs.readFile(path.join(here, name), "utf8"));
const fmt = (n) => n.toLocaleString("en-US");
const dec = (n, digits = 1) => n.toFixed(digits);
const pct = (n, digits = 0) => `${dec(n * 100, digits)}%`;

/** One chart, two themes, plus the <picture> block that selects between them. */
async function emit(name, build, legend, altText) {
    for (const [mode, c] of Object.entries(THEMES)) {
        const { body, width, height } = build(c);
        const legendItems = legend ? legend(c) : [];
        const offset = legendItems.length > 0 ? 34 : 0;
        const shifted = offset > 0 ? `<g transform="translate(0 ${offset})">${body}</g>` : body;
        const svg = standalone(
            (offset > 0 ? svgLegend(legendItems, c) : "") + shifted,
            width,
            height + offset,
            c
        );
        await fs.writeFile(path.join(chartDir, `${name}.${mode}.svg`), svg, "utf8");
    }

    return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/${name}.dark.svg">
  <img alt="${altText}" src="charts/${name}.light.svg">
</picture>`;
}

function table(headers, rows) {
    const head = `| ${headers.join(" | ")} |`;
    const rule = `|${headers.map(() => "---").join("|")}|`;
    const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
    return `${head}\n${rule}\n${body}`;
}

async function main() {
    await fs.mkdir(chartDir, { recursive: true });

    const project = await read("results.json");
    const file = await read("results-file.json");
    const ab = await read("results-ab.json");
    const { summary, runs } = file;

    const ok = runs.filter((r) => !r.error);

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

    const contextRows = perFile.map((entry) => ({
        file: entry.file,
        kind: entry.kind,
        fileTokens: entry.runs[0].fileTokens,
        answerTokens: Math.round(entry.runs.reduce((s, r) => s + r.answerTokens, 0) / entry.runs.length)
    }));

    const baselineTotal = contextRows.reduce((s, r) => s + r.fileTokens, 0);
    const toolTotal = contextRows.reduce((s, r) => s + r.answerTokens, 0);

    const buggyRuns = ok.filter((r) => r.kind === "buggy");
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

    /* ---- charts ---- */

    const contextImg = await emit(
        "context",
        (c) => contextChart(contextRows, c),
        (c) => [
            { color: c.s1, label: "Read the file into context" },
            { color: c.s2, label: "Ask predict_failures" }
        ],
        "Tokens used per file: reading the file versus asking predict_failures"
    );

    const usedOutcomes = [...new Set(ok.map((r) => r.outcome))];
    const outcomeImg = await emit(
        "outcomes",
        (c) => outcomeChart(perFile, summary.trials, c),
        (c) => usedOutcomes.map((key) => ({ color: c[OUTCOME[key].tone], label: `${OUTCOME[key].glyph}  ${OUTCOME[key].label}` })),
        "Outcome by file and trial: whether the tool named the planted line"
    );

    const scoreImg = await emit(
        "scores",
        (c) => scoreStrip(ok, bestCut.t, c),
        (c) => [
            { color: c.s2, label: "Files with a planted bug" },
            { color: c.s1, label: "Clean control files" }
        ],
        "Score distribution for buggy and clean files, with threshold"
    );

    const budgetImg = await emit(
        "budget",
        (c) => budgetChart(project.budgets, project.corpus.bugs, c),
        (c) => [
            { color: c.s1, label: "Risk order (scan_project)" },
            { color: c.s2, label: "Directory order" },
            { color: c.s3, label: "Random (expected)" }
        ],
        "Bugs found at the same file budget using three orderings"
    );

    /* ---- document ---- */

    const md = `# Benchmark results

Does \`predict_failures\` save context for a calling agent, and is its answer
trustworthy enough to act on without reading the file?

Corpus: ${project.corpus.files} generated files with ${project.corpus.bugs} planted bugs.
The per-file test covers ${perFile.length} of them — ${perFile.filter((f) => f.kind === "buggy").length} buggy files and
${perFile.filter((f) => f.kind === "clean").length} clean controls — with ${summary.trials} trials per file using the \`${summary.provider}\` CLI.

## At a glance

| | Result |
|---|---|
| Context used to read the files | **${fmt(baselineTotal)} tokens** |
| Context used to ask the tool | **${fmt(toolTotal)} tokens** (${pct(toolTotal / baselineTotal)}) |
| Trials that named the planted line (±3) | **${summary.buggy.hit} of ${buggyRuns.length}** |
| False alarms on clean code, raw output | **${summary.clean.falsePositive} of ${cleanRuns.length}** |
| False alarms at score ≥ ${bestCut.t} | **${bestCut.falseAlarms} of ${cleanRuns.length}** |
| Latency per file | ${dec(summary.latency.meanMsPerFile / 1000)} s mean, ${dec(summary.latency.maxMs / 1000)} s worst |

The tool is precise when it finds the bug, but its raw output is noisy. The score
can filter out that noise; see section 3.

## 1. Context cost per file

The context cost of learning about the defect: read the file or ask the tool.

${contextImg}

The answer costs roughly the same regardless of file size — ${meanAnswer} tokens on
average — because it contains one line, one pattern, one rationale, and the static
metrics. This creates a break-even point: the tool is cheaper only for files above
roughly ${meanAnswer} tokens, which is ${cheaper} of the ${contextRows.length} files here. For \`lib/retry.js\`,
at ${contextRows.find((r) => r.file.endsWith("retry.js"))?.fileTokens} tokens, asking costs more than reading.

${table(
    ["File", "Type", "Read the file", "Ask the tool", "Difference"],
    contextRows.map((r) => [
        `\`${r.file.replace(/^src\//, "")}\``,
        r.kind === "buggy" ? "bug" : "clean",
        fmt(r.fileTokens),
        fmt(r.answerTokens),
        `${r.answerTokens < r.fileTokens ? "−" : "+"}${fmt(Math.abs(r.fileTokens - r.answerTokens))}`
    ])
)}

## 2. Was the answer correct?

The savings matter only if the agent can trust the answer without reading the file
anyway. The clean files are the control group: they measure whether the tool invents
defects that are not there.

${outcomeImg}

${table(
    ["File", "Type", "Planted line", "Outcome by trial"],
    perFile.map((entry) => [
        `\`${entry.file.replace(/^src\//, "")}\``,
        entry.kind === "buggy" ? "bug" : "clean",
        entry.plantedLine ?? "—",
        entry.runs.map((r) => `${OUTCOME[r.outcome].glyph} ${r.predictedLine ?? "—"}`).join(", ")
    ])
)}

Naming a line counts as a hit when it is within ±3 lines of the planted defect.

## 3. Does the score separate real defects from generic noise?

The false alarms above are not fabricated. They are true but generic — *"\`rows.map\`
assumes that \`db.query\` always returns an array"*. The question is whether the score
can filter them out.

${scoreImg}

${table(
    ["Threshold", "Bugs found", "False alarms"],
    sweep.map((s) => [
        String(s.t),
        `${s.found} of ${buggyRuns.length}`,
        `${s.falseAlarms} of ${cleanRuns.length}`
    ])
)}

At **score ≥ ${bestCut.t}**, the tool finds ${bestCut.found} of ${buggyRuns.length} planted bugs
with ${bestCut.falseAlarms} false alarms. The planted bugs score 0.70–0.90; the noise peaks at 0.60.

> **The threshold is fitted on the same trials used to evaluate it.** It is a hypothesis
> that must be reconfirmed on unseen code, not a constant.

## 4. A/B test with real agents

Two agents, the same four files, and the same task. One had to read the files; the
other could only call \`predict_failures\` and apply the threshold from section 3.
Neither was told which files contained bugs.

${table(
    ["", ab.arms.readTheFile.label, ab.arms.askTheTool.label],
    [
        ["Total tokens used", fmt(ab.arms.readTheFile.totalTokens), `**${fmt(ab.arms.askTheTool.totalTokens)}**`],
        ["Time", `${dec(ab.arms.readTheFile.durationMs / 1000)} s`, `**${dec(ab.arms.askTheTool.durationMs / 1000)} s**`],
        ["Source lines read", fmt(ab.arms.readTheFile.linesRead), "0"],
        ["Bugs found", `${ab.summary.bugsFound.readTheFile} of ${ab.summary.bugsFound.of}`, `${ab.summary.bugsFound.askTheTool} of ${ab.summary.bugsFound.of}`],
        ["False alarms", `${ab.summary.falsePositives.readTheFile} of ${ab.summary.falsePositives.of}`, `${ab.summary.falsePositives.askTheTool} of ${ab.summary.falsePositives.of}`]
    ]
)}

**The two agents reached identical conclusions for all four files**, including clearing
the control file and missing the race in \`reconciliationWorker.js\`. The tool-using
agent used ${pct(1 - ab.summary.tokenRatio)} fewer tokens and ${pct(1 - ab.summary.durationRatio)} less time.

${table(
    ["File", "Ground truth", "Without the tool", "With the tool"],
    ab.files.map((f) => [
        `\`${f.file.replace(/^src\//, "")}\``,
        f.truth.defect ? `bug, line ${f.truth.line}` : "clean",
        f.readTheFile.defect ? `line ${f.readTheFile.line} ${f.readTheFile.correct ? "✓" : "✗"}` : `none ${f.readTheFile.correct ? "✓" : "✗"}`,
        f.askTheTool.defect ? `line ${f.askTheTool.line} ${f.askTheTool.correct ? "✓" : "✗"}` : `none (score ${f.askTheTool.score}) ${f.askTheTool.correct ? "✓" : "✗"}`
    ])
)}

The savings here are much smaller — ${pct(1 - ab.summary.tokenRatio)} versus
${pct(1 - toolTotal / baselineTotal)} in section 1. The difference is the agent's own
overhead: its system prompt, reasoning, and response dominate, while file content is
only part of the bill. **Section 1 measures savings on file content; section 4 measures
the savings in practice.**

Two things the tool did not provide:

- The agent that read the code noticed that \`orderService.js\` defines three methods
  twice. The tool did not mention this in any of its four trials on the file. This is
  a corpus artifact (see caveats), but the point stands: reading the code reveals things
  that asking for one answer does not.
- The tool-using agent reported uncertainty about \`orderService.js\`: its 0.6 score was
  just below the threshold, while the rationale sounded concrete. The threshold made
  the correct choice here, but narrowly.

## 5. Project level: does \`scan_project\` help choose a file?

This is a secondary result. At the same budget — read k files — how many of the
${project.corpus.bugs} bugs are included? Random ordering is the null hypothesis.

${budgetImg}

${table(
    ["Budget", "Risk order", "Directory order", "Random (expected)"],
    project.budgets.map((b) => [
        `${b.k} files`,
        `${b.riskOrder.found} of ${project.corpus.bugs}`,
        `${b.directoryOrder.found} of ${project.corpus.bugs}`,
        String(b.randomExpected)
    ])
)}

The ranking beats neither directory order nor random order at any budget. The rank
correlation between \`riskScore\` and raw file size is **ρ = ${project.sizeCorrelation}**:
in practice, it ranks the largest file first. This is not an implementation defect;
it is what a pure complexity heuristic can do. Half the planted bugs are in small
files, and the ranking never finds them.

## Caveats

- **Tokens do not disappear; they move.** \`predict_failures\` spawns another model that
  reads the entire file. The saving is in the calling agent's *context window*, not total
  consumption. The cost is ${dec(summary.latency.meanMsPerFile / 1000)} s of latency per file.
- **The corpus is generated, and its generator has a defect.** Files with more than eight
  methods receive duplicate method names because the name generator cycles.
  \`orderService.js\` defines three methods twice. This makes the "clean" controls less
  clean than intended. The measurements stand, but the corpus is less realistic than it appears.
- **Bugs are placed per file, not per line** — three in large files and three in small
  files. If real defects are distributed evenly per line of code, that favors a
  size-driven ranking per file, but not per token, which is what the agent pays for.
- **${summary.trials} trials per file, and two runs in the A/B test.** This is enough to
  show that the answer varies, not enough for a precise estimate.
  \`reconciliationWorker.js\` scored 0.85 in two trials and was missed in the third.
- **Tokens are counted with cl100k BPE** (gpt-tokenizer), not Claude's tokenizer, except
  in section 4 where the figures come from the harness's own accounting. The ratios hold;
  the absolute figures in sections 1–3 are approximate.

## Run it yourself

\`\`\`bash
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
