/**
 * Chart builders for the Markdown report.
 *
 * The charts are Vega-Lite specifications rendered to standalone SVG at build
 * time. They used to be hand-written SVG strings; Vega-Lite replaced that
 * because the layout arithmetic — tick placement, label collision, legend
 * offsets — was being maintained by hand for every new chart, and it does not
 * need to be.
 *
 * Two constraints shape everything here:
 *
 *   1. A .svg committed to the repo is rendered by GitHub as an image with no
 *      access to the surrounding page's CSS. So every colour is a literal, and
 *      each chart is written twice — once per theme — and paired in a <picture>.
 *   2. The output is committed, so it has to be deterministic. No random jitter,
 *      no timestamps: the same results files must produce byte-identical SVG.
 */
import * as vega from "vega";
import { compile } from "vega-lite";

export const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Literal palettes for standalone SVG. Both validated with the dataviz validator. */
export const THEMES = {
    light: {
        surface: "#fcfcfb",
        textPrimary: "#0b0b0b",
        textSecondary: "#52514e",
        muted: "#898781",
        grid: "#e1e0d9",
        axis: "#c3c2b7",
        s1: "#2a78d6",
        s2: "#eb6834",
        s3: "#1baf7a",
        good: "#0ca30c",
        warning: "#fab219",
        serious: "#ec835a",
        critical: "#d03b3b",
        neutral: "#c3c2b7",
        onFill: "#ffffff",
        onLight: "#0b0b0b"
    },
    dark: {
        surface: "#1a1a19",
        textPrimary: "#ffffff",
        textSecondary: "#c3c2b7",
        muted: "#898781",
        grid: "#2c2c2a",
        axis: "#383835",
        s1: "#3987e5",
        s2: "#d95926",
        s3: "#199e70",
        good: "#0ca30c",
        warning: "#fab219",
        serious: "#ec835a",
        critical: "#d03b3b",
        neutral: "#383835",
        onFill: "#ffffff",
        onLight: "#0b0b0b"
    }
};

export const OUTCOME = {
    hit: { glyph: "✓", tone: "good", onDark: true, label: "Named the correct line" },
    "wrong-location": { glyph: "~", tone: "serious", onDark: true, label: "Found an issue at the wrong location" },
    "false-negative": { glyph: "✗", tone: "critical", onDark: true, label: "Reported the file clean (missed the bug)" },
    "true-negative": { glyph: "·", tone: "neutral", onDark: false, label: "Correctly reported a clean file" },
    "false-positive": { glyph: "!", tone: "warning", onDark: false, label: "False alarm on a clean file" }
};

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/**
 * Theme applied to every chart, so a spec only ever describes its data and
 * encoding. Vega-Lite's own defaults assume a white page and a browser font
 * stack; both are wrong for a standalone .svg on a dark GitHub page.
 */
function themeConfig(c) {
    return {
        background: c.surface,
        font: SANS,
        padding: 12,
        view: { stroke: null },
        axis: {
            labelColor: c.textSecondary,
            labelFontSize: 11.5,
            titleColor: c.textSecondary,
            titleFontSize: 12,
            titleFontWeight: 500,
            titlePadding: 10,
            domainColor: c.axis,
            tickColor: c.axis,
            gridColor: c.grid,
            gridWidth: 1,
            labelPadding: 6
        },
        legend: {
            labelColor: c.textPrimary,
            labelFontSize: 12,
            titleColor: c.textSecondary,
            titleFontSize: 11.5,
            symbolType: "square",
            symbolSize: 130,
            orient: "top",
            direction: "horizontal",
            offset: 8,
            padding: 0,
            columnPadding: 18,
            titleLimit: 0,
            labelLimit: 0
        },
        header: { labelColor: c.textPrimary, labelFontSize: 12.5, labelFontWeight: 600, titleColor: c.textSecondary },
        title: { color: c.textPrimary, fontSize: 13, fontWeight: 600, anchor: "start", offset: 10 },
        text: { font: SANS },
        bar: { cornerRadiusEnd: 3 }
    };
}

/** Compile one Vega-Lite spec and render it to a standalone SVG string. */
export async function render(spec, c) {
    const view = new vega.View(vega.parse(compile({ ...spec, config: themeConfig(c) }).spec), {
        renderer: "none"
    });
    const svg = await view.toSVG();
    view.finalize();
    // Vega emits the surface as a <rect>; a standalone file also needs it as the
    // element background, or a viewer that ignores the rect shows white gutters.
    return svg.replace("<svg ", `<svg style="background:${c.surface}" `);
}

/* ------------------------------------------------------------------ *
 * 1 -- context cost. Magnitude comparison, so bars from a zero baseline.
 * ------------------------------------------------------------------ */

const READ = "Read the file into context";
const ASK = "Ask predict_failures";

export function contextSpec(rows, c) {
    const values = rows.flatMap((r) => {
        const file = r.file.replace(/^src\//, "");
        return [
            { file, kind: r.kind, series: READ, tokens: r.fileTokens, order: r.fileTokens },
            { file, kind: r.kind, series: ASK, tokens: r.answerTokens, order: r.fileTokens }
        ];
    });

    return {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values },
        width: 560,
        height: { step: 21 },
        encoding: {
            y: {
                field: "file",
                type: "nominal",
                sort: { field: "order", op: "max", order: "descending" },
                axis: { title: null, labelFontSize: 12, labelColor: c.textPrimary, domain: false, ticks: false, labelLimit: 0 }
            },
            x: {
                field: "tokens",
                type: "quantitative",
                axis: { title: "Tokens in the calling agent's context", grid: true, format: ",d" }
            },
            yOffset: { field: "series", sort: [READ, ASK] }
        },
        layer: [
            {
                mark: { type: "bar", height: 13 },
                // The colour scale lives on the bar layer, not the shared
                // encoding: the label layer paints itself and would otherwise
                // union a legend-less scale into this one.
                encoding: {
                    color: {
                        field: "series",
                        type: "nominal",
                        scale: { domain: [READ, ASK], range: [c.s1, c.s2] },
                        legend: { title: null }
                    }
                }
            },
            {
                mark: { type: "text", align: "left", dx: 5, fontSize: 11, font: SANS },
                encoding: {
                    text: { field: "tokens", type: "quantitative", format: ",d" },
                    color: { value: c.textSecondary }
                }
            }
        ]
    };
}

/* ------------------------------------------------------------------ *
 * 2 -- outcome per trial. State, not magnitude, so this is the status
 * palette; every cell carries a glyph as well as a colour.
 * ------------------------------------------------------------------ */

export function outcomeSpec(perFile, trials, c) {
    const values = [];
    for (const entry of perFile) {
        const file = entry.file.replace(/^src\//, "");
        for (let t = 1; t <= trials; t++) {
            const run = entry.runs.find((r) => r.trial === t);
            const meta = run ? OUTCOME[run.outcome] : null;
            values.push({
                file,
                trial: `Trial ${t}`,
                outcome: meta ? meta.label : "no result",
                glyph: meta ? meta.glyph : "",
                fill: meta ? c[meta.tone] : c.neutral,
                ink: meta && meta.onDark ? c.onFill : c.onLight,
                sort: entry.kind === "buggy" ? 0 : 1
            });
        }
    }

    const used = [...new Set(values.map((v) => v.outcome))];

    return {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values },
        width: { step: 74 },
        height: { step: 30 },
        encoding: {
            x: {
                field: "trial",
                type: "nominal",
                axis: { title: null, orient: "top", labelColor: c.textSecondary, domain: false, ticks: false }
            },
            y: {
                field: "file",
                type: "nominal",
                sort: { field: "sort" },
                axis: { title: null, labelFontSize: 12, labelColor: c.textPrimary, domain: false, ticks: false, labelLimit: 0 }
            }
        },
        layer: [
            {
                mark: { type: "rect", cornerRadius: 4, stroke: c.surface, strokeWidth: 2 },
                encoding: {
                    color: {
                        field: "outcome",
                        type: "nominal",
                        scale: { domain: used, range: used.map((o) => values.find((v) => v.outcome === o).fill) },
                        legend: { title: null, columns: 2, symbolType: "square" }
                    }
                }
            },
            {
                mark: { type: "text", fontSize: 14, fontWeight: 600, font: SANS },
                encoding: {
                    text: { field: "glyph" },
                    // A literal colour per row. Sharing the `outcome` field with
                    // the rect layer would make Vega-Lite union the two scales
                    // and paint the glyphs in the fill colours; `scale: null`
                    // takes the value straight from the data, and the legend has
                    // to be left unset rather than nulled, or it collides with
                    // the rect layer's legend on the shared position channels.
                    color: { field: "ink", type: "nominal", scale: null }
                }
            }
        ]
    };
}

/* ------------------------------------------------------------------ *
 * 3 -- score distribution. A dot histogram rather than a jittered strip:
 * the file is committed, so the layout has to be deterministic.
 * ------------------------------------------------------------------ */

export function scoreSpec(runs, threshold, c) {
    const BUG = "Files with a planted bug";
    const CLEAN = "Clean control files";

    // Stack duplicates instead of jittering them, so identical scores are
    // countable and the same input always renders the same picture.
    const seen = new Map();
    const values = [];
    for (const run of [...runs].sort((a, b) => (a.file + a.trial).localeCompare(b.file + b.trial))) {
        const group = run.kind === "buggy" ? BUG : CLEAN;
        const score = run.score ?? 0;
        const key = `${group}|${score}`;
        const stack = (seen.get(key) ?? 0) + 1;
        seen.set(key, stack);
        values.push({ group, score, stack, file: run.file.replace(/^src\//, "") });
    }

    // A quiet build piles every clean run on score 0, so the axis has to follow
    // the data rather than a constant chosen when the tool was noisier.
    const tallest = Math.max(...values.map((v) => v.stack), 4);

    return {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values },
        width: 560,
        height: 190,
        layer: [
            {
                mark: { type: "rule", strokeDash: [5, 4], strokeWidth: 1.5 },
                data: { values: [{ threshold }] },
                encoding: {
                    x: { field: "threshold", type: "quantitative" },
                    color: { value: c.textSecondary }
                }
            },
            {
                mark: { type: "text", align: "left", dx: 6, dy: -80, fontSize: 11.5, font: SANS },
                data: { values: [{ threshold, label: `gate ≥ ${threshold}` }] },
                encoding: {
                    x: { field: "threshold", type: "quantitative" },
                    text: { field: "label" },
                    color: { value: c.textSecondary }
                }
            },
            {
                mark: { type: "circle", size: 130, opacity: 1 },
                encoding: {
                    x: {
                        field: "score",
                        type: "quantitative",
                        scale: { domain: [0, 1] },
                        axis: { title: "Model score for the run", grid: true, values: [0, 0.2, 0.4, 0.6, 0.8, 1] }
                    },
                    y: {
                        field: "stack",
                        type: "quantitative",
                        scale: { domain: [0, tallest + 1] },
                        axis: { title: "Runs at this score", grid: false, tickMinStep: 1 }
                    },
                    color: {
                        field: "group",
                        type: "nominal",
                        scale: { domain: [BUG, CLEAN], range: [c.s2, c.s1] },
                        legend: { title: null }
                    }
                }
            }
        ]
    };
}

/* ------------------------------------------------------------------ *
 * 4 -- bugs found at an equal file budget.
 * ------------------------------------------------------------------ */

export function budgetSpec(budgets, totalBugs, c) {
    const RISK = "Risk order (scan_project)";
    const DIR = "Directory order";
    const RAND = "Random (expected)";

    const labels = budgets.map((b) => `${b.k} files`);
    const values = budgets.flatMap((b) => [
        { budget: `${b.k} files`, order: RISK, found: b.riskOrder.found },
        { budget: `${b.k} files`, order: DIR, found: b.directoryOrder.found },
        { budget: `${b.k} files`, order: RAND, found: b.randomExpected }
    ]);

    return {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values },
        width: { step: 46 },
        height: 230,
        encoding: {
            x: {
                field: "budget",
                type: "nominal",
                sort: labels,
                axis: { title: "Files the agent is allowed to read", labelAngle: 0, domain: false, ticks: false }
            },
            xOffset: { field: "order", sort: [RISK, DIR, RAND] },
            y: {
                field: "found",
                type: "quantitative",
                scale: { domain: [0, totalBugs] },
                axis: { title: `Planted bugs included (of ${totalBugs})`, grid: true, tickMinStep: 1 }
            },
            color: {
                field: "order",
                type: "nominal",
                scale: { domain: [RISK, DIR, RAND], range: [c.s1, c.s2, c.s3] },
                legend: { title: null }
            }
        },
        layer: [
            { mark: { type: "bar", width: 14 } },
            {
                mark: { type: "text", dy: -7, fontSize: 11, font: SANS },
                encoding: {
                    text: { field: "found", type: "quantitative", format: ".2~f" },
                    color: { value: c.textSecondary }
                }
            }
        ]
    };
}

/* ------------------------------------------------------------------ *
 * 5 -- provider comparison. Two measures that trade against each other,
 * so they are faceted rather than stacked on one axis.
 * ------------------------------------------------------------------ */

export function providerSpec(providers, c) {
    const RAW = "Raw model reply";
    const GATED = "After the actionable gate";
    const FOUND = "Planted lines found";
    const ALARM = "False alarms on clean code";

    const values = providers.flatMap((p) => [
        { provider: p.label, measure: FOUND, stage: RAW, count: p.rawHits, of: p.buggyRuns },
        { provider: p.label, measure: FOUND, stage: GATED, count: p.gatedHits, of: p.buggyRuns },
        { provider: p.label, measure: ALARM, stage: RAW, count: p.rawFalseAlarms, of: p.cleanRuns },
        { provider: p.label, measure: ALARM, stage: GATED, count: p.gatedFalseAlarms, of: p.cleanRuns }
    ]);
    const max = Math.max(...values.map((v) => v.of));

    return {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values },
        columns: 2,
        facet: { field: "measure", type: "nominal", sort: [FOUND, ALARM], header: { title: null } },
        spec: {
            width: { step: 44 },
            height: 210,
            encoding: {
                x: {
                    field: "provider",
                    type: "nominal",
                    axis: { title: null, labelAngle: 0, labelColor: c.textPrimary, labelFontSize: 12, domain: false, ticks: false }
                },
                xOffset: { field: "stage", sort: [RAW, GATED] },
                y: {
                    field: "count",
                    type: "quantitative",
                    scale: { domain: [0, max] },
                    axis: { title: `Runs (of ${max})`, grid: true, tickMinStep: 2 }
                },
                color: {
                    field: "stage",
                    type: "nominal",
                    scale: { domain: [RAW, GATED], range: [c.s1, c.s3] },
                    legend: { title: null }
                }
            },
            layer: [
                { mark: { type: "bar", width: 16 } },
                {
                    mark: { type: "text", dy: -7, fontSize: 11, font: SANS },
                    encoding: {
                        text: { field: "count", type: "quantitative" },
                        color: { value: c.textSecondary }
                    }
                }
            ]
        }
    };
}
