/**
 * Builds the benchmark corpus: a plausible order-management backend with a
 * known set of planted bugs.
 *
 * Bugs are placed deliberately across the complexity range -- three in heavy
 * files, three in small ones -- so the benchmark can show where the risk
 * heuristic works and where it does not. Planting them only in complex files
 * would make the ranking look better than it is.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { acceptableRanges } from "./enclosing-function.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "corpus");
const srcRoot = path.join(root, "src");

/* ---------------------------------------------------------------- *
 * Filler generators. Parameterised so complexity varies across the
 * tree; a scan that ranks everything the same proves nothing.
 * ---------------------------------------------------------------- */

const pick = (arr, i) => arr[i % arr.length];
const NOUNS = ["order", "invoice", "shipment", "customer", "payment", "refund", "coupon", "address"];
const VERBS = ["fetch", "resolve", "normalise", "collect", "reconcile", "expand", "flatten", "merge"];
const QUALIFIERS = ["", "ById", "ForOwner", "Recent", "Pending", "Archived", "ForExport", "Stale"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/**
 * A distinct method name for every index.
 *
 * Both word lists have eight entries, and every name used to be built from a
 * single index into both of them, so a class with more than eight members
 * defined the same method twice. `adminController.js` had eight duplicated
 * names out of nineteen members, `orderRepository.js` eight out of eighteen.
 *
 * That was not cosmetic. Those files are clean controls, and the duplication is
 * a real defect the tool reports, so the answer key called a correct finding a
 * false alarm. It also inflated the "cost of reading the file" baseline with
 * dead code. It confused five separate measurements before it was fixed.
 *
 * Cycling the second word only after the first has wrapped gives 64 distinct
 * names, past any file here.
 */
const memberName = (i) => `${pick(VERBS, i)}${cap(NOUNS[Math.floor(i / VERBS.length) % NOUNS.length])}`;
const queryName = (i) =>
    `find${cap(pick(NOUNS, i))}s${QUALIFIERS[Math.floor(i / NOUNS.length) % QUALIFIERS.length]}`;

function controller(name, { routes, guards }) {
    const body = Array.from({ length: routes }, (_, r) => {
        const checks = Array.from({ length: guards }, (_, g) => `
        if (!req.body.${pick(NOUNS, g)}Id) {
            return res.status(400).json({ error: "${pick(NOUNS, g)}Id is required" });
        }`).join("");
        return `
    async ${memberName(r)}(req, res) {${checks}
        try {
            const result = await this.service.${pick(VERBS, r)}(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("${name} failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }`;
    }).join("\n");

    return `const { toDto } = require("../lib/serialise");

/** HTTP surface for ${name.replace(/Controller$/, "")} operations. */
class ${name} {
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
${body}

    register(router) {
        router.use((req, res, next) => {
            if (!req.user) {
                return res.status(401).end();
            }
            next();
        });
    }
}

module.exports = { ${name}, toDto };
`;
}

function service(name, { methods, loops, awaits, branches }) {
    const body = Array.from({ length: methods }, (_, m) => {
        const inner = Array.from({ length: loops }, (_, l) => `
        for (const ${pick(NOUNS, l)} of batch) {
            for (const line of ${pick(NOUNS, l)}.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }`).join("");
        const waits = Array.from({ length: awaits }, (_, a) => `
        const ${pick(NOUNS, a)}Rows = await this.repo.find${cap(pick(NOUNS, a))}s(id);`).join("");
        const ifs = Array.from({ length: branches }, (_, b) => `
        if (options.${pick(VERBS, b)} === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.${pick(VERBS, b)} === "strict") {
            total = Math.floor(total);
        }`).join("");

        return `
    async ${memberName(m)}(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);${waits}${inner}${ifs}
        return { id, total };
    }`;
    }).join("\n");

    return `/** Application logic for ${name.replace(/Service$/, "")}. */
class ${name} {
    constructor(repo, clock) {
        this.repo = repo;
        this.clock = clock;
    }
${body}
}

module.exports = { ${name} };
`;
}

function repository(name, { queries }) {
    const body = Array.from({ length: queries }, (_, q) => `
    async ${queryName(q)}(id) {
        const rows = await this.db.query(
            "SELECT * FROM ${pick(NOUNS, q)}s WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }`).join("\n");

    return `/** Data access for ${name.replace(/Repository$/, "")}. */
class ${name} {
    constructor(db) {
        this.db = db;
    }
${body}

    async loadBatch(id) {
        const rows = await this.db.query("SELECT * FROM batches WHERE id = $1", [id]);
        return rows;
    }
}

module.exports = { ${name} };
`;
}

function util(name, { funcs, branches }) {
    const names = Array.from({ length: funcs }, (_, f) => `${pick(VERBS, f)}${cap(name)}${f}`);
    const body = names.map((fnName, f) => {
        const ifs = Array.from({ length: branches }, (_, b) => `
    if (typeof value === "${pick(["string", "number", "object"], b)}") {
        return String(value).trim();
    }`).join("");
        return `
function ${fnName}(value) {${ifs}
    return value == null ? null : value;
}`;
    }).join("\n");

    return `/** Small helpers around ${name}. */
${body}

module.exports = { ${names.join(", ")} };
`;
}

function model(name, { fields }) {
    const props = Array.from({ length: fields }, (_, f) => `        this.${pick(NOUNS, f)}${f} = row.${pick(NOUNS, f)}_${f} ?? null;`).join("\n");
    return `/** Row mapper for ${name}. */
class ${name} {
    constructor(row) {
${props}
    }

    toJSON() {
        return { ...this };
    }
}

module.exports = { ${name} };
`;
}

/* ---------------------------------------------------------------- *
 * The clean tree.
 * ---------------------------------------------------------------- */

const clean = [
    ["src/api/orderController.js", controller("OrderController", { routes: 14, guards: 3 })],
    ["src/api/invoiceController.js", controller("InvoiceController", { routes: 9, guards: 2 })],
    ["src/api/shipmentController.js", controller("ShipmentController", { routes: 11, guards: 3 })],
    ["src/api/customerController.js", controller("CustomerController", { routes: 7, guards: 2 })],
    ["src/api/refundController.js", controller("RefundController", { routes: 10, guards: 4 })],
    ["src/api/webhookController.js", controller("WebhookController", { routes: 6, guards: 1 })],
    ["src/api/adminController.js", controller("AdminController", { routes: 16, guards: 3 })],
    ["src/api/healthController.js", controller("HealthController", { routes: 3, guards: 0 })],

    ["src/services/orderService.js", service("OrderService", { methods: 11, loops: 1, awaits: 3, branches: 2 })],
    ["src/services/invoiceService.js", service("InvoiceService", { methods: 8, loops: 1, awaits: 2, branches: 2 })],
    ["src/services/shipmentService.js", service("ShipmentService", { methods: 8, loops: 2, awaits: 2, branches: 1 })],
    ["src/services/customerService.js", service("CustomerService", { methods: 6, loops: 0, awaits: 2, branches: 1 })],
    ["src/services/refundService.js", service("RefundService", { methods: 9, loops: 1, awaits: 3, branches: 2 })],
    ["src/services/notificationService.js", service("NotificationService", { methods: 6, loops: 0, awaits: 3, branches: 1 })],
    ["src/services/taxService.js", service("TaxService", { methods: 8, loops: 2, awaits: 1, branches: 3 })],
    ["src/services/auditService.js", service("AuditService", { methods: 5, loops: 0, awaits: 2, branches: 0 })],

    ["src/repositories/orderRepository.js", repository("OrderRepository", { queries: 16 })],
    ["src/repositories/invoiceRepository.js", repository("InvoiceRepository", { queries: 12 })],
    ["src/repositories/shipmentRepository.js", repository("ShipmentRepository", { queries: 9 })],
    ["src/repositories/customerRepository.js", repository("CustomerRepository", { queries: 13 })],
    ["src/repositories/paymentRepository.js", repository("PaymentRepository", { queries: 10 })],
    ["src/repositories/auditRepository.js", repository("AuditRepository", { queries: 6 })],

    ["src/lib/serialise.js", util("serialise", { funcs: 12, branches: 3 })],
    ["src/lib/currency.js", util("currency", { funcs: 8, branches: 4 })],
    ["src/lib/strings.js", util("strings", { funcs: 15, branches: 3 })],
    ["src/lib/ids.js", util("ids", { funcs: 6, branches: 2 })],
    ["src/lib/env.js", util("env", { funcs: 7, branches: 3 })],
    ["src/lib/headers.js", util("headers", { funcs: 9, branches: 2 })],
    ["src/lib/paging.js", util("paging", { funcs: 5, branches: 2 })],

    ["src/models/order.js", model("Order", { fields: 22 })],
    ["src/models/invoice.js", model("Invoice", { fields: 18 })],
    ["src/models/shipment.js", model("Shipment", { fields: 14 })],
    ["src/models/customer.js", model("Customer", { fields: 19 })],
    ["src/models/payment.js", model("Payment", { fields: 15 })]
];

/* ---------------------------------------------------------------- *
 * The planted bugs. Hand-written so each one is a realistic mistake
 * rather than a marker the scanner could pattern-match.
 * ---------------------------------------------------------------- */

const bugs = [
    {
        file: "src/services/pricingService.js",
        anchor: "const next = tiers[i + 1];",
        pattern: "off-by-one",
        complexity: "high",
        summary: "Tier loop reads tiers[i + 1] without bounding i, so the last tier dereferences undefined.",
        source: `const { roundMoney } = require("../lib/currency");

/**
 * Volume pricing. Tiers arrive sorted ascending by minQuantity.
 */
class PricingService {
    constructor(repo, clock) {
        this.repo = repo;
        this.clock = clock;
    }

    async quote(orderId, options = {}) {
        const order = await this.repo.loadBatch(orderId);
        const tiers = await this.repo.findCoupons(orderId);
        let total = 0;

        for (const line of order.lines) {
            total += this.priceLine(line, tiers, options);
        }

        if (options.includeTax === true) {
            const rate = await this.repo.taxRate(order.region);
            total = total * (1 + rate);
        }

        return { orderId, total: roundMoney(total) };
    }

    priceLine(line, tiers, options) {
        let unit = line.unitPrice;

        for (let i = 0; i < tiers.length; i++) {
            const tier = tiers[i];
            const next = tiers[i + 1];

            if (line.quantity >= tier.minQuantity && line.quantity < next.minQuantity) {
                unit = tier.unitPrice;
                break;
            }
        }

        if (options.strict === true && unit > line.unitPrice) {
            unit = line.unitPrice;
        }

        let subtotal = 0;
        for (let q = 0; q < line.quantity; q++) {
            subtotal += unit;
            if (options.roundEach === true) {
                subtotal = roundMoney(subtotal);
            }
        }

        return subtotal;
    }

    async bulkQuote(orderIds, options = {}) {
        const results = [];
        for (const id of orderIds) {
            const quote = await this.quote(id, options);
            if (quote.total > 0) {
                results.push(quote);
            }
        }
        return results;
    }

    async explainQuote(orderId, options = {}) {
        const quote = await this.quote(orderId, options);
        const order = await this.repo.loadBatch(orderId);
        const parts = [];

        for (const line of order.lines) {
            parts.push({
                sku: line.sku,
                quantity: line.quantity,
                listPrice: line.unitPrice,
                charged: this.priceLine(line, await this.repo.findCoupons(orderId), options)
            });
        }

        return { orderId, total: quote.total, parts };
    }

    async applyCoupon(orderId, code) {
        const coupon = await this.repo.findCouponByCode(code);
        if (!coupon) {
            return { orderId, applied: false, reason: "unknown coupon" };
        }
        if (coupon.expiresAt != null && coupon.expiresAt < this.clock.now()) {
            return { orderId, applied: false, reason: "expired" };
        }
        if (coupon.minimumTotal != null) {
            const quote = await this.quote(orderId);
            if (quote.total < coupon.minimumTotal) {
                return { orderId, applied: false, reason: "below minimum" };
            }
        }
        await this.repo.attachCoupon(orderId, coupon.id);
        return { orderId, applied: true, coupon: coupon.id };
    }

    async priceHistory(sku, days) {
        const rows = await this.repo.priceChanges(sku, days);
        const history = [];
        let previous = null;

        for (const row of rows) {
            if (previous != null && row.unitPrice !== previous) {
                history.push({ at: row.changedAt, from: previous, to: row.unitPrice });
            }
            previous = row.unitPrice;
        }

        return history;
    }

    async marginFor(orderId) {
        const quote = await this.quote(orderId);
        const costs = await this.repo.costsFor(orderId);
        let cost = 0;

        for (const entry of costs) {
            if (entry.kind === "goods") {
                cost += entry.amount;
            } else if (entry.kind === "shipping" && entry.billable === true) {
                cost += entry.amount;
            }
        }

        return { orderId, revenue: quote.total, cost, margin: quote.total - cost };
    }

    async repriceAll(region, options = {}) {
        const orders = await this.repo.ordersInRegion(region);
        const updated = [];

        for (const order of orders) {
            const quote = await this.quote(order.id, options);
            if (quote.total !== order.total) {
                await this.repo.updateTotal(order.id, quote.total);
                updated.push(order.id);
            }
        }

        return { region, updated: updated.length };
    }
}

module.exports = { PricingService };
`
    },
    {
        file: "src/workers/reconciliationWorker.js",
        anchor: "const balance = await this.ledger.balanceOf(account.id);",
        pattern: "race-condition",
        complexity: "high",
        summary: "Balance is read before the awaits and written back after, so concurrent ticks lose updates.",
        source: `/**
 * Periodically reconciles ledger balances against settled payments.
 */
class ReconciliationWorker {
    constructor(repo, ledger, logger) {
        this.repo = repo;
        this.ledger = ledger;
        this.logger = logger;
        this.running = false;
    }

    async start(intervalMs) {
        this.running = true;
        while (this.running) {
            try {
                await this.tick();
            } catch (err) {
                this.logger.error("reconciliation tick failed", { err: err.message });
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }

    async tick() {
        const accounts = await this.repo.findPayments("pending");

        for (const account of accounts) {
            const balance = await this.ledger.balanceOf(account.id);
            const settled = await this.repo.settledSince(account.id, account.lastSeenAt);

            let adjusted = balance;
            for (const payment of settled) {
                if (payment.status === "settled") {
                    adjusted += payment.amount;
                } else if (payment.status === "reversed") {
                    adjusted -= payment.amount;
                }
            }

            await this.ledger.write(account.id, adjusted);
            await this.repo.markSeen(account.id, Date.now());
        }
    }

    stop() {
        this.running = false;
    }

    async backfill(since) {
        const accounts = await this.repo.findPayments("all");
        const repaired = [];

        for (const account of accounts) {
            const entries = await this.ledger.entriesSince(account.id, since);
            let sum = 0;

            for (const entry of entries) {
                if (entry.kind === "credit") {
                    sum += entry.amount;
                } else if (entry.kind === "debit") {
                    sum -= entry.amount;
                }
            }

            const recorded = await this.ledger.balanceOf(account.id);
            if (Math.abs(recorded - sum) > 0.005) {
                await this.ledger.write(account.id, sum);
                repaired.push(account.id);
            }
        }

        return { repaired: repaired.length };
    }

    async report(window) {
        const accounts = await this.repo.findPayments("pending");
        const rows = [];

        for (const account of accounts) {
            const settled = await this.repo.settledSince(account.id, window.from);
            let credits = 0;
            let debits = 0;

            for (const payment of settled) {
                if (payment.amount >= 0) {
                    credits += payment.amount;
                } else {
                    debits += payment.amount;
                }
            }

            rows.push({ account: account.id, credits, debits, net: credits + debits });
        }

        return rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    }

    async retryFailed(limit) {
        const failures = await this.repo.failedReconciliations(limit);
        let recovered = 0;

        for (const failure of failures) {
            try {
                await this.ledger.write(failure.accountId, failure.expected);
                await this.repo.clearFailure(failure.id);
                recovered += 1;
            } catch (err) {
                this.logger.error("retry failed", { id: failure.id, err: err.message });
            }
        }

        return { attempted: failures.length, recovered };
    }
}

module.exports = { ReconciliationWorker };
`
    },
    {
        file: "src/services/inventoryService.js",
        anchor: "lines.forEach(async (line) => {",
        pattern: "async-misuse",
        complexity: "high",
        summary: "await inside forEach is not awaited, so reserve() returns before any stock is decremented.",
        source: `/** Stock reservation and release. */
class InventoryService {
    constructor(repo, cache, logger) {
        this.repo = repo;
        this.cache = cache;
        this.logger = logger;
    }

    async availability(sku) {
        const cached = await this.cache.get(sku);
        if (cached != null) {
            return cached;
        }
        const rows = await this.repo.findShipments(sku);
        let onHand = 0;
        for (const row of rows) {
            if (row.warehouse !== "quarantine") {
                onHand += row.quantity;
            }
        }
        await this.cache.set(sku, onHand);
        return onHand;
    }

    async reserve(orderId, lines) {
        const reserved = [];

        lines.forEach(async (line) => {
            const available = await this.availability(line.sku);
            if (available >= line.quantity) {
                await this.repo.decrement(line.sku, line.quantity);
                reserved.push(line.sku);
            } else {
                this.logger.warn("insufficient stock", { sku: line.sku });
            }
        });

        return { orderId, reserved };
    }

    async release(orderId, lines) {
        for (const line of lines) {
            await this.repo.increment(line.sku, line.quantity);
            await this.cache.del(line.sku);
        }
        return { orderId, released: lines.length };
    }

    async transfer(sku, fromWarehouse, toWarehouse, quantity) {
        const rows = await this.repo.findShipments(sku);
        const source = rows.find((row) => row.warehouse === fromWarehouse);

        if (!source || source.quantity < quantity) {
            return { sku, moved: 0, reason: "insufficient stock at source" };
        }

        await this.repo.decrementAt(sku, fromWarehouse, quantity);
        await this.repo.incrementAt(sku, toWarehouse, quantity);
        await this.cache.del(sku);

        return { sku, moved: quantity };
    }

    async lowStockReport(threshold) {
        const skus = await this.repo.allSkus();
        const low = [];

        for (const sku of skus) {
            const onHand = await this.availability(sku);
            if (onHand < threshold) {
                low.push({ sku, onHand });
            }
        }

        return low.sort((a, b) => a.onHand - b.onHand);
    }

    async reconcileCounts(warehouse, counted) {
        const rows = await this.repo.findByWarehouse(warehouse);
        const drift = [];

        for (const row of rows) {
            const actual = counted[row.sku];
            if (actual == null) {
                continue;
            }
            if (actual !== row.quantity) {
                drift.push({ sku: row.sku, expected: row.quantity, actual });
                await this.repo.setQuantity(row.sku, warehouse, actual);
                await this.cache.del(row.sku);
            }
        }

        return { warehouse, drift };
    }

    async quarantine(sku, quantity, reason) {
        const available = await this.availability(sku);
        if (available < quantity) {
            this.logger.warn("cannot quarantine more than is on hand", { sku });
            return { sku, quarantined: 0 };
        }

        await this.repo.moveTo(sku, "quarantine", quantity);
        await this.repo.logQuarantine(sku, quantity, reason);
        await this.cache.del(sku);

        return { sku, quarantined: quantity };
    }
}

module.exports = { InventoryService };
`
    },
    {
        file: "src/lib/dateWindow.js",
        anchor: "for (let i = 0; i <= days; i++) {",
        pattern: "off-by-one",
        complexity: "low",
        summary: "Loop bound is <= days, so every window contains one extra day.",
        source: `/** Builds inclusive-start, exclusive-end date windows. */

const DAY_MS = 24 * 60 * 60 * 1000;

function windowDays(start, days) {
    const out = [];
    for (let i = 0; i <= days; i++) {
        out.push(new Date(start.getTime() + i * DAY_MS));
    }
    return out;
}

function isWithin(date, start, end) {
    return date >= start && date < end;
}

module.exports = { windowDays, isWithin, DAY_MS };
`
    },
    {
        file: "src/models/cartTotals.js",
        anchor: "const discount = row.discount.amount;",
        pattern: "null-pointer",
        complexity: "low",
        summary: "discount is optional on the row but dereferenced unguarded, throwing for carts with no coupon.",
        source: `/** Derived totals for a cart row. */

function cartTotals(row) {
    const lines = row.lines || [];
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const discount = row.discount.amount;

    return {
        subtotal,
        discount,
        total: subtotal - discount
    };
}

module.exports = { cartTotals };
`
    },
    {
        file: "src/lib/retry.js",
        anchor: "} catch (err) {",
        pattern: "async-misuse",
        complexity: "low",
        summary: "The final attempt's rejection is swallowed, so retry resolves undefined instead of throwing.",
        source: `/** Retry an async operation with linear backoff. */

async function retry(fn, attempts = 3, delayMs = 100) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            await new Promise((resolve) => setTimeout(resolve, delayMs * i));
        }
    }
}

module.exports = { retry };
`
    }
];

/* ---------------------------------------------------------------- */

function lineOf(source, anchor, file) {
    const index = source.indexOf(anchor);
    if (index === -1) {
        throw new Error(`anchor not found in ${file}: ${anchor}`);
    }
    return source.slice(0, index).split("\n").length;
}

async function main() {
    await fs.rm(root, { recursive: true, force: true });

    const written = [];

    for (const [rel, source] of clean) {
        const target = path.join(root, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, source, "utf8");
        written.push(rel);
    }

    for (const bug of bugs) {
        const target = path.join(root, bug.file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bug.source, "utf8");
        written.push(bug.file);
    }

    // Line numbers are derived from an anchor rather than written by hand, so
    // the manifest cannot drift out of sync with the source it describes.
    const manifest = {
        generatedBy: "bench/generate-corpus.mjs",
        language: "javascript",
        corpus: "corpus",
        fileCount: written.length,
        // The per-file harness used to hardcode these. Naming them here keeps
        // the answer key and the control group in one file, so a corpus can be
        // measured without the harness knowing anything about it.
        controls: [
            "src/services/orderService.js",
            "src/api/adminController.js",
            "src/repositories/orderRepository.js",
            "src/lib/paging.js",
            "src/models/payment.js",
            "src/services/auditService.js"
        ],
        bugs: bugs.map(({ source, anchor, alsoAnchor, ...rest }) => {
            const line = lineOf(source, anchor, rest.file);
            const acceptableLines = alsoAnchor
                ? [line, lineOf(source, alsoAnchor, rest.file)]
                : [line];
            return {
                ...rest,
                line,
                acceptableLines,
                // The function the defect lives in, so grading can ask whether
                // the prediction sent a reader to the right place rather than
                // whether it landed inside an arbitrary line tolerance.
                acceptableRanges: acceptableRanges(source, acceptableLines),
                anchor: anchor.trim()
            };
        })
    };

    await fs.writeFile(path.join(here, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    const high = bugs.filter((b) => b.complexity === "high").length;
    console.log(`wrote ${written.length} files to ${srcRoot}`);
    console.log(`planted ${bugs.length} bugs: ${high} in complex files, ${bugs.length - high} in simple files`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
