import fs from "node:fs/promises";
import path from "node:path";

/**
 * Cases built to make a second-opinion scorer earn its place.
 *
 * The existing corpus cannot measure ranking. v0.8.0 scores 51/51 on it with no false
 * alarms, so a replay yields 92 correct findings against 3 wrong ones and one
 * reclassification swings the AUC by a third. A scorer is only worth having if it can
 * tell a correct finding from a wrong one, and that needs wrong ones to exist.
 *
 * Two kinds, because a scorer can fail in two directions:
 *
 *   controls  - code that matches a bug shape the detector knows, and is safe anyway.
 *               The invariant that makes it safe is always visible in the same file, so
 *               a low evidence score is a judgment the scorer can actually make rather
 *               than a guess about code it was never shown. A finding here is a false
 *               alarm, and false alarms are the negative class the ranking test needs.
 *   bugs      - real defects wearing innocuous shapes, to catch the opposite failure:
 *               a scorer that wins on controls by disbelieving every finding.
 *
 * These are adversarial by construction and say nothing about held-out accuracy. They
 * extend the existing answer key rather than forming a second corpus, so results stay
 * comparable with everything already in RESULTS.md.
 */

/** Derive line numbers from anchor text so the answer key cannot drift from the source. */
function lineOf(source, anchor, file) {
    const lines = source.split("\n");
    const index = lines.findIndex(line => line.includes(anchor));
    if (index < 0) throw Error(`Anchor not found in ${file}: ${anchor}`);
    if (lines.filter(line => line.includes(anchor)).length > 1) throw Error(`Ambiguous anchor in ${file}: ${anchor}`);
    return index + 1;
}

const controls = {
    // The planted off-by-one in pricingService.js reads tiers[i + 1] on an unbounded loop.
    // This is that shape with the bound present, so the two differ only in the guard.
    "src/adversarial/bounded-lookahead.js": `/** Tier pricing with a correctly bounded lookahead. */

function rateFor(tiers, quantity) {
    if (!Array.isArray(tiers) || tiers.length === 0) {
        return 0;
    }
    for (let i = 0; i < tiers.length - 1; i++) {
        const current = tiers[i];
        const next = tiers[i + 1];
        if (quantity >= current.minQuantity && quantity < next.minQuantity) {
            return current.rate;
        }
    }
    return tiers[tiers.length - 1].rate;
}

module.exports = { rateFor };
`,

    // inventoryService.js awaits inside forEach and returns early. This is the same
    // reservation flow written with for...of, where every await is actually awaited.
    "src/adversarial/sequential-reserve.js": `/** Stock reservation that awaits every line and decrements atomically. */

class Reserver {
    constructor(repo, logger) {
        this.repo = repo;
        this.logger = logger;
    }

    async reserve(orderId, lines) {
        const reserved = [];
        for (const line of lines) {
            // Conditional decrement in the store: there is no window between
            // deciding there is stock and taking it.
            const taken = await this.repo.decrementIfAvailable(line.sku, line.quantity);
            if (taken) {
                reserved.push(line.sku);
            } else {
                this.logger.warn("insufficient stock", { sku: line.sku });
            }
        }
        return { orderId, reserved };
    }
}

module.exports = { Reserver };
`,

    // reconciliationWorker.js loses updates because it reads before awaiting and writes
    // after. Here the read-modify-write is inside a lock acquired in the same function.
    "src/adversarial/locked-balance.js": `/** Balance adjustment serialised by an explicit per-account lock. */

class LedgerTick {
    constructor(ledger, locks) {
        this.ledger = ledger;
        this.locks = locks;
    }

    async settle(account, entries) {
        const release = await this.locks.acquire(account.id);
        try {
            const balance = (await this.ledger.balanceOf(account.id)) ?? 0;
            let next = balance;
            for (const entry of entries) {
                next += entry.amount;
            }
            await this.ledger.write(account.id, next);
            return next;
        } finally {
            release();
        }
    }
}

module.exports = { LedgerTick };
`,

    "src/adversarial/guarded-profile.js": `/** Display helper whose guard sits well above the dereference. */

function displayName(session) {
    if (!session || !session.user || typeof session.user.displayName !== "string") {
        return "Guest";
    }

    const locale = session.locale || "en-US";
    const formatter = new Intl.DateTimeFormat(locale);
    const joined = session.joinedAt ? formatter.format(session.joinedAt) : "unknown";

    const label = session.user.displayName.trim();
    return label.length > 0 ? \`\${label} (since \${joined})\` : \`Member since \${joined}\`;
}

module.exports = { displayName };
`,

    "src/adversarial/checked-divisor.js": `/** Average order value, with the zero case handled before the division. */

function averageOrderValue(orders) {
    const settled = orders.filter((order) => order.status === "settled");
    if (settled.length === 0) {
        return 0;
    }
    const total = settled.reduce((sum, order) => sum + order.amountCents, 0);
    return Math.round(total / settled.length);
}

module.exports = { averageOrderValue };
`,

    "src/adversarial/closed-handle.js": `/** Export writer that always releases its handle. */

class ExportWriter {
    constructor(storage) {
        this.storage = storage;
    }

    async write(name, rows) {
        const handle = await this.storage.open(name);
        try {
            let written = 0;
            for (const row of rows) {
                await handle.append(JSON.stringify(row));
                written += 1;
            }
            await handle.flush();
            return written;
        } finally {
            await handle.close();
        }
    }
}

module.exports = { ExportWriter };
`,

    "src/adversarial/preset-index.js": `/** Index built immediately before it is read. */

function summarise(records) {
    const index = new Map();
    for (const record of records) {
        index.set(record.id, { id: record.id, total: 0 });
    }
    for (const record of records) {
        index.get(record.id).total += record.amount;
    }
    return [...index.values()];
}

module.exports = { summarise };
`,

    "src/adversarial/validated-index.js": `/** Page lookup that validates its index before using it. */

function pageAt(pages, raw) {
    const requested = Number.parseInt(raw, 10);
    if (!Number.isInteger(requested) || requested < 0 || requested >= pages.length) {
        return null;
    }
    return pages[requested].rows;
}

module.exports = { pageAt };
`,

    "src/adversarial/empty-rows.js": `/** Report header derived from the first row, behind an emptiness check. */

function headerFor(rows) {
    if (rows.length === 0) {
        return { columns: [], generatedAt: null };
    }
    const columns = Object.keys(rows[0]);
    return { columns, generatedAt: rows[0].capturedAt };
}

module.exports = { headerFor };
`,

    "src/adversarial/deep-clone-config.js": `/** Overrides applied to a deep copy, leaving the caller's config untouched. */

function withOverrides(config, overrides) {
    const copy = structuredClone(config ?? {});
    copy.retry = copy.retry ?? { attempts: 3, backoffMs: 100 };
    copy.retry.attempts = overrides.attempts ?? copy.retry.attempts;
    copy.retry.backoffMs = overrides.backoffMs ?? copy.retry.backoffMs;
    return copy;
}

module.exports = { withOverrides };
`,

    "src/adversarial/optional-chain.js": `/** Address formatting across a fully optional chain. */

function shippingCity(order) {
    const city = order?.customer?.addresses?.shipping?.city;
    return typeof city === "string" && city.length > 0 ? city : "unknown";
}

module.exports = { shippingCity };
`,

    "src/adversarial/awaited-later.js": `/** Work started eagerly and awaited inside the try that handles its failure. */

class ReportJob {
    constructor(client, logger) {
        this.client = client;
        this.logger = logger;
    }

    async run(reportId) {
        const pending = this.client.render(reportId);
        try {
            const rendered = await pending;
            return { reportId, bytes: rendered.length };
        } catch (error) {
            this.logger.error("render failed", { reportId, message: error.message });
            return { reportId, bytes: 0 };
        }
    }
}

module.exports = { ReportJob };
`,

    "src/adversarial/copied-sort.js": `/** Ranking that sorts a copy, so the caller's array keeps its order. */

function topSuppliers(suppliers, limit) {
    return [...suppliers]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);
}

module.exports = { topSuppliers };
`,

    "src/adversarial/integer-cents.js": `/** Totals kept in integer cents, so equality comparisons are exact. */

function isSettled(invoice) {
    const charged = invoice.lines.reduce((sum, line) => sum + line.amountCents, 0);
    const paid = invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    return charged === paid;
}

module.exports = { isSettled };
`
};

const bugs = [
    {
        file: "src/adversarial/shallow-overrides.js",
        pattern: "other",
        anchor: "copy.retry.attempts = overrides.attempts",
        summary: "Spread copies only the top level, so writing copy.retry.attempts mutates the caller's shared retry object.",
        source: `/** Overrides applied to what looks like a private copy. */

function withOverrides(config, overrides) {
    const copy = { ...config };
    copy.retry = copy.retry ?? { attempts: 3, backoffMs: 100 };
    // config may be absent; the defect is the shallow copy above, not this.
    copy.retry.attempts = overrides.attempts ?? copy.retry.attempts;
    copy.retry.backoffMs = overrides.backoffMs ?? copy.retry.backoffMs;
    return copy;
}

module.exports = { withOverrides };
`
    },
    {
        file: "src/adversarial/float-cents.js",
        pattern: "other",
        anchor: "return charged === paid;",
        summary: "Amounts are floating-point currency, so accumulated representation error makes the strict equality fail for values that are equal.",
        source: `/** Settlement check over floating-point currency amounts. */

function isSettled(invoice) {
    const charged = invoice.lines.reduce((sum, line) => sum + line.amount, 0);
    const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    return charged === paid;
}

module.exports = { isSettled };
`
    },
    {
        file: "src/adversarial/in-place-sort.js",
        pattern: "other",
        anchor: ".sort((a, b) => b.volume - a.volume)",
        summary: "sort mutates the caller's array, so suppliers is reordered as a side effect of asking for a ranking.",
        source: `/** Ranking that sorts the array it was handed. */

function topSuppliers(suppliers, limit) {
    return suppliers
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);
}

module.exports = { topSuppliers };
`
    },
    {
        file: "src/adversarial/unawaited-close.js",
        pattern: "async-misuse",
        anchor: "handle.close();",
        summary: "close() returns a promise that is never awaited, so write resolves before the handle is flushed and closed.",
        source: `/** Export writer that releases its handle without waiting. */

class ExportWriter {
    constructor(storage) {
        this.storage = storage;
    }

    async write(name, rows) {
        const handle = await this.storage.open(name);
        try {
            let written = 0;
            for (const row of rows) {
                await handle.append(JSON.stringify(row));
                written += 1;
            }
            return written;
        } finally {
            handle.close();
        }
    }
}

module.exports = { ExportWriter };
`
    },
    {
        file: "src/adversarial/var-capture.js",
        pattern: "other",
        anchor: "schedule(() => notify(pending[i]),",
        summary: "var is function-scoped, so every scheduled callback reads the same i and notifies pending[pending.length] repeatedly.",
        source: `/** Reminder scheduling over a var-scoped loop counter. */

function scheduleReminders(pending, schedule, notify) {
    for (var i = 0; i < pending.length; i++) {
        schedule(() => notify(pending[i]), i * 1000);
    }
    return pending.length;
}

module.exports = { scheduleReminders };
`
    },
    {
        file: "src/adversarial/filtered-average.js",
        pattern: "other",
        anchor: "return Math.round(total / orders.length);",
        summary: "The total sums only settled orders but the divisor counts every order, so the average is understated whenever any order is unsettled.",
        source: `/** Average order value across settled orders. */

function averageOrderValue(orders) {
    if (orders.length === 0) {
        return 0;
    }
    const total = orders
        .filter((order) => order.status === "settled")
        .reduce((sum, order) => sum + order.amountCents, 0);
    return Math.round(total / orders.length);
}

module.exports = { averageOrderValue };
`
    }
];

/** Written into the existing corpus so these cases extend the answer key in place. */
export async function writeAdversarialCases(root) {
    for (const [name, source] of Object.entries(controls)) {
        const file = path.join(root, name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, source, "utf8");
    }
    for (const bug of bugs) {
        const file = path.join(root, bug.file);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bug.source, "utf8");
    }
    return {
        fileCount: Object.keys(controls).length + bugs.length,
        note: "Adversarial cases. Controls match a known bug shape but are safe, and the invariant " +
            "proving it is visible in the same file. Bugs wear innocuous shapes. Built to create a " +
            "negative class for ranking measurement, not to estimate held-out accuracy.",
        bugs: bugs.map(({ source, anchor, ...rest }) => {
            const line = lineOf(source, anchor, rest.file);
            return { ...rest, line, acceptableLines: [line],
                acceptableRanges: [[Math.max(1, line - 3), line + 3]], anchor: anchor.trim() };
        }),
        controls: Object.keys(controls)
    };
}
