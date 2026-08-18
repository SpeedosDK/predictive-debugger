/**
 * Deterministic half of the benchmark.
 *
 * Drives the real MCP server over stdio -- not a reimplementation of the
 * scoring -- and compares three review strategies over the same corpus:
 *
 *   read-all      the agent reads every source file into context
 *   arbitrary     the agent reads files in directory order until it has seen
 *                 every buggy file (the honest control: any strategy that
 *                 stops early saves tokens, so the ranking has to beat this)
 *   scan-first    the agent calls scan_project once, then reads files in the
 *                 order it returns
 *
 * Token counts use cl100k BPE (gpt-tokenizer). That is not Claude's tokenizer,
 * so treat the absolute numbers as within a few percent, and the ratios --
 * which is what the benchmark is about -- as sound.
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
const corpusSrc = path.join(here, "corpus", "src");

const tokens = (text) => encode(text).length;

async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await walk(full)));
        } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Spearman rank correlation.
 *
 * Used to ask the awkward question: does riskScore carry information beyond
 * "this file is long"? If it tracks raw size almost perfectly, then ranking by
 * risk is ranking by size, and the ranking is only useful where bugs happen to
 * live in the big files.
 */
function spearman(xs, ys) {
    const rank = (values) => {
        const order = values.map((value, i) => [value, i]).sort((a, b) => a[0] - b[0]);
        const ranks = new Array(values.length);
        for (let i = 0; i < order.length; ) {
            let j = i;
            while (j + 1 < order.length && order[j + 1][0] === order[i][0]) {
                j += 1;
            }
            const shared = (i + j) / 2 + 1;
            for (let k = i; k <= j; k++) {
                ranks[order[k][1]] = shared;
            }
            i = j + 1;
        }
        return ranks;
    };

    const rx = rank(xs);
    const ry = rank(ys);
    const n = xs.length;
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(rx);
    const my = mean(ry);

    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i++) {
        num += (rx[i] - mx) * (ry[i] - my);
        dx += (rx[i] - mx) ** 2;
        dy += (ry[i] - my) ** 2;
    }
    return num / Math.sqrt(dx * dy);
}

/** Files read, in order, until every buggy file has been seen. */
function costToFindAll(order, buggy, sizes) {
    const remaining = new Set(buggy);
    let read = 0;
    let cost = 0;

    for (const file of order) {
        read += 1;
        cost += sizes.get(file) ?? 0;
        remaining.delete(file);
        if (remaining.size === 0) {
            return { filesRead: read, tokens: cost, foundAll: true };
        }
    }
    return { filesRead: read, tokens: cost, foundAll: remaining.size === 0 };
}

async function main() {
    const files = await walk(corpusSrc);
    const manifest = JSON.parse(await fs.readFile(path.join(here, "manifest.json"), "utf8"));

    const rel = (abs) => path.relative(path.join(here, "corpus"), abs).replace(/\\/g, "/");
    const buggy = new Set(manifest.bugs.map((bug) => bug.file));

    // Token cost of each file, keyed by corpus-relative path.
    const sizes = new Map();
    let totalTokens = 0;
    for (const abs of files) {
        const source = await fs.readFile(abs, "utf8");
        const count = tokens(source);
        sizes.set(rel(abs), count);
        totalTokens += count;
    }

    /* ---- the real tool call, over stdio ---- */

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(repoRoot, "dist", "mcp-server.js")],
        cwd: repoRoot
    });
    const client = new Client({ name: "predictive-debugger-bench", version: "1.0.0" });
    await client.connect(transport);

    async function scanProject(limit) {
        const started = performance.now();
        const response = await client.callTool({
            name: "scan_project",
            arguments: { directory: corpusSrc, limit }
        });
        const wallClockMs = performance.now() - started;
        const text = response.content.map((part) => part.text).join("");
        return { wallClockMs, text, tokens: tokens(text), value: JSON.parse(text) };
    }

    const full = await scanProject(50);
    // The agent chooses `limit`, and the output is the dominant cost of the
    // strategy, so measure a shortlist too rather than only the full dump.
    const shortlist = await scanProject(10);

    const scanMs = full.wallClockMs;
    const scanTokens = full.tokens;
    const scan = full.value;
    await client.close();

    const ranked = scan.files.map((entry) => ({
        file: rel(entry.file),
        riskScore: entry.riskScore,
        signals: entry.signals
    }));

    /* ---- strategies ---- */

    const rankedOrder = ranked.map((entry) => entry.file);
    const arbitraryOrder = files.map(rel);

    const scanFirst = costToFindAll(rankedOrder, buggy, sizes);
    const arbitrary = costToFindAll(arbitraryOrder, buggy, sizes);

    const strategies = {
        readAll: {
            label: "Read every file",
            filesRead: files.length,
            tokens: totalTokens,
            foundAll: true
        },
        arbitrary: {
            label: "Read in directory order until all bugs seen",
            ...arbitrary
        },
        scanFirst: {
            label: "scan_project, then read in risk order",
            filesRead: scanFirst.filesRead,
            // The scan output itself lands in the agent's context and must be paid for.
            tokens: scanFirst.tokens + scanTokens,
            scanTokens,
            foundAll: scanFirst.foundAll
        }
    };

    /* ---- ranking quality ---- */

    const rankOf = new Map(rankedOrder.map((file, i) => [file, i + 1]));
    const bugRanks = manifest.bugs
        .map((bug) => ({ ...bug, rank: rankOf.get(bug.file) ?? null }))
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

    const recallAt = [1, 3, 5, 10, 20].map((k) => ({
        k,
        found: bugRanks.filter((bug) => bug.rank !== null && bug.rank <= k).length,
        of: bugRanks.length
    }));

    /* ---- fixed-budget comparison ----
     *
     * The fair question. Any strategy that reads less saves tokens, so the
     * ranking has to earn its keep at an equal budget: given room for k files,
     * does risk order surface more bugs than the order the agent would have
     * used anyway? Random order is the null hypothesis -- with b bugs in n
     * files, k files picked blind contain b*k/n of them on average.
     */
    const budgets = [5, 10, 15, 20].map((k) => {
        const bugsIn = (order) => order.slice(0, k).filter((file) => buggy.has(file)).length;
        const tokensFor = (order, extra) =>
            order.slice(0, k).reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0) + extra;

        return {
            k,
            riskOrder: { found: bugsIn(rankedOrder), tokens: tokensFor(rankedOrder, shortlist.tokens) },
            directoryOrder: { found: bugsIn(arbitraryOrder), tokens: tokensFor(arbitraryOrder, 0) },
            randomExpected: Number(((buggy.size * k) / files.length).toFixed(2))
        };
    });

    /* ---- equal *token* budget ----
     *
     * The strongest form of the comparison, and the one that steelmans the
     * tool. Ranking by risk means reading the big files first, so at an equal
     * file budget it covers more code -- which flatters it if bugs are spread
     * per line rather than per file. Holding tokens constant removes that
     * advantage and asks the real question: for the same context spend, does
     * risk order put more bugs in front of the agent?
     */
    const tokenBudgets = [5000, 10000, 20000].map((budget) => {
        const walk = (order, overhead) => {
            let spent = overhead;
            let found = 0;
            let read = 0;
            for (const file of order) {
                const cost = sizes.get(file) ?? 0;
                if (spent + cost > budget) {
                    break;
                }
                spent += cost;
                read += 1;
                if (buggy.has(file)) {
                    found += 1;
                }
            }
            return { found, filesRead: read, tokensSpent: spent };
        };

        return {
            budget,
            riskOrder: walk(rankedOrder, shortlist.tokens),
            directoryOrder: walk(arbitraryOrder, 0)
        };
    });

    const sizeCorrelation = spearman(
        ranked.map((entry) => entry.riskScore),
        ranked.map((entry) => sizes.get(entry.file) ?? 0)
    );

    const results = {
        generatedAt: new Date().toISOString(),
        sizeCorrelation: Number(sizeCorrelation.toFixed(3)),
        tokenizer: "cl100k (gpt-tokenizer) — approximation of Claude's tokenizer",
        corpus: {
            files: files.length,
            totalTokens,
            bugs: manifest.bugs.length
        },
        scan: {
            wallClockMs: Math.round(scanMs),
            scanned: scan.scanned,
            returned: scan.returned,
            outputTokens: scanTokens,
            shortlistTokens: shortlist.tokens,
            shortlistWallClockMs: Math.round(shortlist.wallClockMs)
        },
        strategies,
        recallAt,
        budgets,
        bugRanks: bugRanks.map((bug) => ({
            file: bug.file,
            line: bug.line,
            pattern: bug.pattern,
            complexity: bug.complexity,
            summary: bug.summary,
            rank: bug.rank,
            riskScore: ranked.find((entry) => entry.file === bug.file)?.riskScore ?? null
        })),
        ranked
    };

    await fs.writeFile(path.join(here, "results.json"), JSON.stringify(results, null, 2), "utf8");

    /* ---- console report ---- */

    const pct = (n) => `${(n * 100).toFixed(1)}%`;
    const row = (a, b, c, d) =>
        `  ${String(a).padEnd(46)}${String(b).padStart(7)}${String(c).padStart(11)}${String(d).padStart(12)}`;

    console.log(`\nCorpus: ${files.length} files, ${totalTokens.toLocaleString()} tokens, ${manifest.bugs.length} planted bugs`);
    console.log(`scan_project: ${Math.round(scanMs)} ms, ${scanTokens.toLocaleString()} tokens of output, no model call\n`);

    console.log(row("Strategy", "files", "tokens", "vs read-all"));
    console.log("  " + "-".repeat(76));
    for (const s of [strategies.readAll, strategies.arbitrary, strategies.scanFirst]) {
        const ratio = s.tokens / totalTokens;
        console.log(row(s.label, s.filesRead, s.tokens.toLocaleString(), pct(ratio)));
    }

    console.log("\n  Where the planted bugs landed in the risk ranking:");
    for (const bug of results.bugRanks) {
        const mark = bug.rank <= 10 ? "hit " : "miss";
        console.log(
            `    ${mark} #${String(bug.rank).padStart(2)}/${files.length}  risk ${bug.riskScore.toFixed(3)}  ${bug.complexity.padEnd(4)}  ${bug.file}`
        );
    }

    console.log("\n  Equal budget — read k files, how many of the 6 bugs are in them?");
    console.log(`    ${"budget".padEnd(12)}${"risk order".padStart(12)}${"dir order".padStart(12)}${"random (exp)".padStart(14)}`);
    for (const b of budgets) {
        console.log(
            `    ${(b.k + " files").padEnd(12)}${String(b.riskOrder.found).padStart(12)}${String(b.directoryOrder.found).padStart(12)}${String(b.randomExpected).padStart(14)}`
        );
    }

    console.log(
        `\n  Rank correlation between riskScore and raw file size: rho = ${sizeCorrelation.toFixed(3)}`
    );
    console.log(`  scan_project output: ${scanTokens.toLocaleString()} tokens at limit 50, ${shortlist.tokens.toLocaleString()} at limit 10`);

    console.log(`\nwrote ${path.relative(repoRoot, path.join(here, "results.json")).replace(/\\/g, "/")}\n`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
