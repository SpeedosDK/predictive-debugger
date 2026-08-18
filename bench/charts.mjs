/**
 * Chart builders for the Markdown report.
 *
 * Every builder takes a `c` colour map whose values are any valid CSS colour
 * string. The Markdown report passes literal hex because a standalone .svg on
 * GitHub is rendered as an image and gets no CSS from the page around it.
 */

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

const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmt = (n) => n.toLocaleString("en-US");

/**
 * Wraps a chart body as a standalone document: its own surface, its own font.
 * Used for the .svg files the markdown report links to.
 */
export function standalone(body, width, height, c) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family='${SANS}'>
  <rect width="${width}" height="${height}" rx="12" fill="${c.surface}"/>
  ${body}
</svg>
`;
}

/** A legend rendered inside the SVG, for the standalone files that have no HTML around them. */
export function svgLegend(items, c, x = 24, y = 22) {
    let cursor = x;
    return items
        .map((item) => {
            const swatch = `<rect x="${cursor}" y="${y - 9}" width="11" height="11" rx="3" fill="${item.color}"/>`;
            const text = `<text x="${cursor + 18}" y="${y}" font-size="12.5" fill="${c.textSecondary}">${esc(item.label)}</text>`;
            cursor += 18 + item.label.length * 6.6 + 22;
            return swatch + text;
        })
        .join("");
}

/* ------------------------------------------------------------------ *
 * 1 -- context cost per file. One axis (tokens), two series, so a
 * legend is required and the bar tips carry direct labels.
 * ------------------------------------------------------------------ */
export function contextChart(rows, c, { top = 8 } = {}) {
    const W = 900;
    const rowH = 44;
    const barH = 15; // under the 24px cap; two bars plus a 2px surface gap per row
    const padL = 250;
    const padR = 90;
    const H = top + rows.length * rowH + 8;
    const max = Math.max(...rows.flatMap((r) => [r.fileTokens, r.answerTokens]));
    const scale = (v) => (v / max) * (W - padL - padR);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((max * f) / 100) * 100);

    const grid = ticks
        .map(
            (t) =>
                `<line x1="${padL + scale(t)}" y1="${top}" x2="${padL + scale(t)}" y2="${H - 8}" stroke="${c.grid}" stroke-width="1"/>` +
                `<text x="${padL + scale(t)}" y="${H + 6}" font-size="11.5" fill="${c.muted}" text-anchor="middle">${fmt(t)}</text>`
        )
        .join("");

    const bars = rows
        .map((r, i) => {
            const y = top + i * rowH;
            const wFile = Math.max(scale(r.fileTokens), 2);
            const wAns = Math.max(scale(r.answerTokens), 2);
            const label = r.file.replace(/^src\//, "");
            const yA = y + 4;
            const yB = y + 4 + barH + 2;
            // A square root at the baseline plus a rounded data-end: the bar
            // grows from the axis rather than floating with two round ends.
            const bar = (yy, w, fill) =>
                `<rect x="${padL}" y="${yy}" width="${w}" height="${barH}" rx="4" fill="${fill}"/>` +
                `<rect x="${padL}" y="${yy}" width="4" height="${barH}" fill="${fill}"/>`;

            return `<g><title>${esc(label)}
Read the file: ${fmt(r.fileTokens)} tokens
Ask predict_failures: ${fmt(r.answerTokens)} tokens</title>
    <text x="${padL - 12}" y="${y + 17}" font-size="12.5" fill="${c.textPrimary}" text-anchor="end">${esc(label)}</text>
    <text x="${padL - 12}" y="${y + 31}" font-size="11" fill="${c.muted}" text-anchor="end">${r.kind === "buggy" ? "bug" : "clean"}</text>
    ${bar(yA, wFile, c.s1)}
    ${bar(yB, wAns, c.s2)}
    <text x="${padL + wFile + 8}" y="${yA + barH - 3}" font-size="11.5" fill="${c.textSecondary}">${fmt(r.fileTokens)}</text>
    <text x="${padL + wAns + 8}" y="${yB + barH - 3}" font-size="11.5" fill="${c.textSecondary}">${fmt(r.answerTokens)}</text>
  </g>`;
        })
        .join("");

    return { body: grid + bars, width: W, height: H + 18 };
}

/* ------------------------------------------------------------------ *
 * 2 -- outcome per trial. State, not magnitude, so this is the status
 * palette; every cell carries a glyph as well as a colour.
 * ------------------------------------------------------------------ */
export function outcomeChart(perFile, trials, c, { top = 22 } = {}) {
    const cell = 30;
    const gap = 2; // the surface gap, same mechanism as between bars
    const padL = 250;
    const W = 900;
    const H = top + perFile.length * (cell + gap) + 6;

    const head = Array.from({ length: trials }, (_, t) =>
        `<text x="${padL + t * (cell + gap) + cell / 2}" y="${top - 8}" font-size="11.5" fill="${c.muted}" text-anchor="middle">trial ${t + 1}</text>`
    ).join("");

    const rows = perFile
        .map((entry, i) => {
            const y = top + i * (cell + gap);
            const label = entry.file.replace(/^src\//, "");
            const cells = entry.runs
                .map((run, t) => {
                    const o = OUTCOME[run.outcome];
                    const x = padL + t * (cell + gap);
                    return `<g><title>${esc(label)} — trial ${t + 1}
${esc(o.label)}
Points to line ${run.predictedLine ?? "—"}${entry.plantedLine ? ` (planted: ${entry.plantedLine})` : ""}
${esc(run.reason ?? "")}</title>
      <rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="4" fill="${c[o.tone]}"/>
      <text x="${x + cell / 2}" y="${y + cell / 2 + 5}" font-size="14" font-weight="600" fill="${o.onDark ? c.onFill : c.onLight}" text-anchor="middle">${o.glyph}</text></g>`;
                })
                .join("");
            return `<text x="${padL - 12}" y="${y + cell / 2 + 4}" font-size="12.5" fill="${c.textPrimary}" text-anchor="end">${esc(label)}</text>${cells}`;
        })
        .join("");

    return { body: head + rows, width: W, height: H };
}

/* ------------------------------------------------------------------ *
 * 3 -- score distribution by class, as a strip plot.
 *
 * The question is whether two distributions separate, so plot every
 * observation. A mean would hide exactly the overlap the reader needs.
 * ------------------------------------------------------------------ */
export function scoreStrip(runs, threshold, c) {
    const W = 900;
    const H = 190;
    const padL = 150;
    const padR = 30;
    const padT = 24;
    const x = (v) => padL + v * (W - padL - padR);

    const lanes = [
        { key: "buggy", y: padT + 28, color: c.s2, label: "Files with a planted bug" },
        { key: "clean", y: padT + 96, color: c.s1, label: "Clean control files" }
    ];

    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1]
        .map(
            (t) =>
                `<line x1="${x(t)}" y1="${padT}" x2="${x(t)}" y2="${H - 34}" stroke="${c.grid}" stroke-width="1"/>` +
                `<text x="${x(t)}" y="${H - 16}" font-size="11.5" fill="${c.muted}" text-anchor="middle">${t.toFixed(1)}</text>`
        )
        .join("");

    const cut =
        `<line x1="${x(threshold)}" y1="${padT - 6}" x2="${x(threshold)}" y2="${H - 34}" stroke="${c.textSecondary}" stroke-width="1"/>` +
        `<text x="${x(threshold)}" y="${padT - 12}" font-size="11.5" fill="${c.textSecondary}" text-anchor="middle">threshold ${threshold}</text>`;

    const dots = lanes
        .map((lane) => {
            const seen = new Map();
            const marks = runs
                .filter((r) => r.kind === lane.key)
                .map((r) => {
                    // Spread ties vertically so overlapping observations stay countable.
                    const n = seen.get(r.score) ?? 0;
                    seen.set(r.score, n + 1);
                    const offset = (n % 5) * 9 - 18;
                    return `<circle cx="${x(r.score)}" cy="${lane.y + offset}" r="5" fill="${lane.color}" stroke="${c.surface}" stroke-width="2"><title>${esc(r.file)} — trial ${r.trial}
score ${r.score}, line ${r.predictedLine ?? "—"}
${esc(r.reason ?? "")}</title></circle>`;
                })
                .join("");
            return `<text x="${padL - 14}" y="${lane.y + 4}" font-size="12.5" fill="${c.textPrimary}" text-anchor="end">${esc(lane.label)}</text>${marks}`;
        })
        .join("");

    return { body: ticks + cut + dots, width: W, height: H };
}

/* ------------------------------------------------------------------ *
 * 4 -- project level, grouped columns.
 * ------------------------------------------------------------------ */
export function budgetChart(budgets, totalBugs, c, { top = 16 } = {}) {
    const W = 900;
    const H = 300;
    const padL = 48;
    const padB = 52;
    const groupW = (W - padL - 24) / budgets.length;
    const barW = 34;
    const y = (v) => top + (1 - v / totalBugs) * (H - top - padB);

    const grid = Array.from({ length: totalBugs + 1 }, (_, i) => i)
        .filter((i) => i % 2 === 0)
        .map(
            (t) =>
                `<line x1="${padL}" y1="${y(t)}" x2="${W - 24}" y2="${y(t)}" stroke="${c.grid}" stroke-width="1"/>` +
                `<text x="${padL - 10}" y="${y(t) + 4}" font-size="11.5" fill="${c.muted}" text-anchor="end">${t}</text>`
        )
        .join("");

    const groups = budgets
        .map((b, i) => {
            const x0 = padL + i * groupW + (groupW - (3 * barW + 4)) / 2;
            const series = [
                { v: b.riskOrder.found, fill: c.s1, name: "Risk order" },
                { v: b.directoryOrder.found, fill: c.s2, name: "Directory order" },
                { v: b.randomExpected, fill: c.s3, name: "Random (expected)" }
            ];
            const bars = series
                .map((s, j) => {
                    const x = x0 + j * (barW + 2);
                    const h = Math.max(y(0) - y(s.v), 0);
                    return `<g><title>${esc(s.name)} at ${b.k} files: ${s.v} of ${totalBugs} bugs</title>
        <rect x="${x}" y="${y(s.v)}" width="${barW}" height="${h}" rx="4" fill="${s.fill}"/>
        <rect x="${x}" y="${y(s.v) + Math.max(h - 4, 0)}" width="${barW}" height="${Math.min(h, 4)}" fill="${s.fill}"/>
        <text x="${x + barW / 2}" y="${y(s.v) - 6}" font-size="11.5" fill="${c.textSecondary}" text-anchor="middle">${s.v}</text></g>`;
                })
                .join("");
            return `${bars}<text x="${x0 + (3 * barW + 4) / 2}" y="${H - padB + 24}" font-size="11.5" fill="${c.muted}" text-anchor="middle">${b.k} files read</text>`;
        })
        .join("");

    return {
        body: `${grid}${groups}<line x1="${padL}" y1="${y(0)}" x2="${W - 24}" y2="${y(0)}" stroke="${c.axis}" stroke-width="1"/>`,
        width: W,
        height: H
    };
}
