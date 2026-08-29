/**
 * Builds the TypeScript benchmark corpus.
 *
 * Kept separate from the JavaScript corpus on purpose. Mixing them would move
 * every number in the report at once, and the whole point of `baseline.json` is
 * that a JavaScript figure from last week is comparable to one from today. With
 * two corpora we can ask whether a prompt change helped TypeScript without
 * hiding what it did to JavaScript.
 *
 * Two things are deliberately different from `generate-corpus.mjs`:
 *
 *   1. Every file is written out by hand rather than assembled from a
 *      parameterised template. The JavaScript generator cycles its name lists,
 *      which silently gave large files duplicate method definitions and made the
 *      "clean" controls less clean than the answer key claimed. A literal file
 *      cannot drift from what it says it is.
 *   2. The planted defects are chosen to cover what the JavaScript corpus never
 *      tested: a resource leak, two defects that fit none of the six catalogued
 *      patterns, and a null dereference where a TypeScript optional type is the
 *      only evidence that the value can be missing.
 *
 * One defect, `invoice.entity.ts`, was not planted. It was written as a clean
 * control and the tool found it on all three trials: a nullable TypeORM column
 * arrives as null, and `isSettled()` compared against undefined. It is marked
 * `discovered: true` in the manifest and kept, because it is a realistic
 * TypeScript defect that no one thought to plant. It is also the reason the
 * controls are worth re-reading rather than trusted: hand-written code is only
 * as clean as its author's attention.
 *
 * The controls carry the syntax the analyser used to choke on: decorated Nest
 * and TypeORM classes, generics, an `.mts` module, and one method long enough to
 * make `longFunctions` fire, which had never happened once across the 40 files of
 * the JavaScript corpus.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { acceptableRanges } from "./enclosing-function.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "corpus-ts");
const srcRoot = path.join(root, "src");

/* ---------------------------------------------------------------- *
 * Clean controls. Written to be obviously correct: every optional
 * value is guarded at the point of use, and every acquired resource is
 * released. A control that turns out to contain a real defect would
 * score as a false alarm that is not one, so they stay boring.
 * ---------------------------------------------------------------- */

const controls = [
    [
        "src/api/order.controller.ts",
        `import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { OrderService } from "../services/order.service";
import type { OrderDto, PageQuery } from "../lib/types";

@Controller("orders")
export class OrderController {
    constructor(private readonly orders: OrderService) {}

    @Get(":id")
    async findOne(@Param("id") id: string): Promise<OrderDto | null> {
        const order = await this.orders.byId(id);
        return order ?? null;
    }

    @Get()
    async list(@Query() query: PageQuery): Promise<OrderDto[]> {
        const page = query.page ?? 0;
        const size = query.size ?? 25;
        return this.orders.page(page, size);
    }

    @Post()
    async create(@Body() body: OrderDto): Promise<OrderDto> {
        return this.orders.create(body);
    }

    @Post(":id/cancel")
    async cancel(@Param("id") id: string): Promise<{ cancelled: boolean }> {
        const order = await this.orders.byId(id);
        if (!order) {
            return { cancelled: false };
        }
        await this.orders.cancel(order.id);
        return { cancelled: true };
    }

    @Get(":id/lines")
    async lines(@Param("id") id: string): Promise<OrderDto["lines"]> {
        const order = await this.orders.byId(id);
        return order?.lines ?? [];
    }

    @Get(":id/total")
    async total(@Param("id") id: string): Promise<number> {
        const order = await this.orders.byId(id);
        if (!order) {
            return 0;
        }
        return order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    }
}
`
    ],
    [
        "src/services/report.service.ts",
        `import { Injectable } from "@nestjs/common";
import type { Ledger, MonthlySummary, Posting } from "../lib/types";

@Injectable()
export class ReportService {
    constructor(private readonly ledger: Ledger) {}

    /**
     * One long method on purpose: the metric that counts functions over twenty
     * statements never fired anywhere in the JavaScript corpus, so nothing was
     * exercising it. Long, but correct.
     */
    async monthlySummary(accountId: string, month: string): Promise<MonthlySummary> {
        const postings: Posting[] = await this.ledger.postings(accountId, month);
        const opening = await this.ledger.openingBalance(accountId, month);
        let credits = 0;
        let debits = 0;
        let reversals = 0;
        let fees = 0;
        let largestCredit = 0;
        let largestDebit = 0;
        let count = 0;
        const currencies = new Set<string>();
        const days = new Map<string, number>();

        for (const posting of postings) {
            count += 1;
            currencies.add(posting.currency);
            const day = posting.postedAt.slice(0, 10);
            days.set(day, (days.get(day) ?? 0) + 1);

            if (posting.kind === "credit") {
                credits += posting.amount;
                largestCredit = Math.max(largestCredit, posting.amount);
            } else if (posting.kind === "debit") {
                debits += posting.amount;
                largestDebit = Math.max(largestDebit, posting.amount);
            } else if (posting.kind === "reversal") {
                reversals += posting.amount;
            } else if (posting.kind === "fee") {
                fees += posting.amount;
            }
        }

        const net = credits - debits - fees + reversals;
        const closing = opening + net;
        const busiestDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        const currency = currencies.size === 1 ? [...currencies][0] : "MIXED";
        const average = count === 0 ? 0 : net / count;
        const feeRatio = credits === 0 ? 0 : fees / credits;
        const reversalCount = postings.filter((posting) => posting.kind === "reversal").length;
        const currencyList = [...currencies].sort();
        const quietDays = [...days.values()].filter((seen) => seen === 1).length;

        return {
            accountId,
            month,
            opening,
            closing,
            credits,
            debits,
            fees,
            reversals,
            count,
            currency,
            busiestDay,
            largestCredit,
            largestDebit,
            average,
            feeRatio,
            reversalCount,
            currencyList,
            quietDays
        };
    }

    async accountsWithActivity(month: string): Promise<string[]> {
        const accounts = await this.ledger.accounts();
        const active: string[] = [];
        for (const account of accounts) {
            const postings = await this.ledger.postings(account.id, month);
            if (postings.length > 0) {
                active.push(account.id);
            }
        }
        return active;
    }
}
`
    ],
    [
        "src/repositories/customer.repository.ts",
        `import type { Customer, Db, Page } from "../lib/types";

/** Data access for customers. Generic over the row shape the driver returns. */
export class CustomerRepository<TRow extends { id: string }> {
    constructor(private readonly db: Db) {}

    async byId(id: string): Promise<TRow | null> {
        const rows = await this.db.query<TRow>("SELECT * FROM customers WHERE id = $1", [id]);
        return rows[0] ?? null;
    }

    async page(offset: number, limit: number): Promise<Page<TRow>> {
        const rows = await this.db.query<TRow>(
            "SELECT * FROM customers ORDER BY created_at DESC OFFSET $1 LIMIT $2",
            [offset, limit]
        );
        const total = await this.db.count("customers");
        return { rows, total, offset, limit };
    }

    async search(term: string): Promise<TRow[]> {
        if (term.trim() === "") {
            return [];
        }
        return this.db.query<TRow>("SELECT * FROM customers WHERE name ILIKE $1", [\`%\${term}%\`]);
    }

    async emailFor(customer: Customer): Promise<string | null> {
        const contact = customer.contact;
        if (!contact || !contact.email) {
            return null;
        }
        return contact.email.toLowerCase();
    }
}
`
    ],
    [
        "src/models/receipt.entity.ts",
        `import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "receipts" })
export class Receipt {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ type: "varchar", length: 32 })
    reference!: string;

    @Column({ type: "numeric" })
    amount!: number;

    // A nullable column arrives as null, never undefined, so the property is
    // typed and compared as null throughout.
    @Column({ type: "timestamptz", nullable: true })
    refundedAt: Date | null = null;

    @Column({ type: "text", nullable: true })
    memo: string | null = null;

    isRefunded(): boolean {
        return this.refundedAt !== null;
    }

    describe(): string {
        const suffix = this.memo === null ? "" : \` (\${this.memo})\`;
        return \`\${this.reference}: \${this.amount}\${suffix}\`;
    }
}
`
    ],
    [
        "src/lib/money.ts",
        `/**
 * Money helpers.
 *
 * Every function except add() is total. add() rejects a currency mismatch by
 * throwing, because silently picking one of the two currencies would corrupt a
 * total rather than fail it.
 */

export interface Money {
    amount: number;
    currency: string;
}

export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export function add(a: Money, b: Money): Money {
    if (a.currency !== b.currency) {
        throw new Error(\`cannot add \${a.currency} to \${b.currency}\`);
    }
    return { amount: roundMoney(a.amount + b.amount), currency: a.currency };
}

export function format(money: Money | null | undefined): string {
    if (!money) {
        return "-";
    }
    return \`\${roundMoney(money.amount).toFixed(2)} \${money.currency}\`;
}

export function isPositive(money: Money | null | undefined): boolean {
    return money !== null && money !== undefined && money.amount > 0;
}
`
    ],
    [
        "src/lib/headers.mts",
        `/** Header helpers, in an .mts module so the scan has one to find. */

export type HeaderBag = Record<string, string | string[] | undefined>;

export function firstValue(headers: HeaderBag, name: string): string | null {
    const raw = headers[name.toLowerCase()];
    if (raw === undefined) {
        return null;
    }
    return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export function hasHeader(headers: HeaderBag, name: string): boolean {
    return firstValue(headers, name) !== null;
}

export function contentType(headers: HeaderBag): string | null {
    const value = firstValue(headers, "content-type");
    return value === null ? null : value.split(";")[0].trim();
}
`
    ]
];

/* ---------------------------------------------------------------- *
 * The planted defects.
 *
 * `acceptableLines` exists for defects whose acquisition and release
 * sit in different methods. A resource leak has two defensible answers:
 * the line that acquires the handle, and the teardown that fails to
 * release it. Grading only one of them measures the benchmark's taste
 * rather than the tool's accuracy.
 * ---------------------------------------------------------------- */

const bugs = [
    {
        file: "src/models/invoice.entity.ts",
        anchor: "return this.settledAt !== undefined;",
        pattern: "null-vs-undefined",
        inCatalogue: true,
        complexity: "low",
        discovered: true,
        summary:
            "settledAt is a nullable TypeORM column, so an unsettled row loads as null rather than undefined, and isSettled() returns true for every unsettled invoice.",
        source: `import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Customer } from "./customer.entity";

@Entity({ name: "invoices" })
export class Invoice {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @Column({ type: "varchar", length: 32 })
    reference!: string;

    @Column({ type: "numeric" })
    amount!: number;

    @Column({ type: "varchar", length: 3, default: "DKK" })
    currency!: string;

    @Column({ type: "timestamptz", nullable: true })
    settledAt?: Date;

    @Column({ type: "text", nullable: true })
    note?: string;

    @ManyToOne(() => Customer, (customer) => customer.invoices)
    customer!: Customer;

    isSettled(): boolean {
        return this.settledAt !== undefined;
    }

    describe(): string {
        const suffix = this.note === undefined ? "" : \` (\${this.note})\`;
        return \`\${this.reference}: \${this.amount} \${this.currency}\${suffix}\`;
    }
}
`
    },
    {
        file: "src/services/cache.service.ts",
        anchor: "this.sweep = setInterval(",
        alsoAnchor: "this.entries.clear();",
        pattern: "resource-leak",
        inCatalogue: true,
        complexity: "high",
        summary:
            "The sweep interval started in the constructor is never cleared on destroy, so the timer keeps the process alive after shutdown.",
        source: `import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { Clock } from "../lib/types";

interface CacheEntry {
    value: unknown;
    expiresAt: number;
}

/**
 * In-memory cache with a background sweep.
 *
 * Implements OnModuleDestroy so the container can release what this holds.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly sweep: NodeJS.Timeout;

    constructor(private readonly clock: Clock) {
        this.sweep = setInterval(() => this.evictExpired(), 60_000);
    }

    onModuleDestroy(): void {
        this.entries.clear();
    }

    get<T>(key: string): T | null {
        const entry = this.entries.get(key);
        if (!entry) {
            return null;
        }
        if (entry.expiresAt <= this.clock.now()) {
            this.entries.delete(key);
            return null;
        }
        return entry.value as T;
    }

    set(key: string, value: unknown, ttlMs: number): void {
        this.entries.set(key, { value, expiresAt: this.clock.now() + ttlMs });
    }

    delete(key: string): void {
        this.entries.delete(key);
    }

    private evictExpired(): void {
        const now = this.clock.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }

    size(): number {
        return this.entries.size;
    }
}
`
    },
    {
        file: "src/services/supplier.service.ts",
        anchor: "return suppliers.filter((supplier) => !supplier.active);",
        pattern: "inverted-condition",
        inCatalogue: false,
        complexity: "low",
        summary:
            "eligible() returns the inactive suppliers, the exact opposite of what its documentation and name promise. No exception is thrown; the caller sends purchase orders to suspended suppliers.",
        source: `import { Injectable } from "@nestjs/common";
import type { Supplier, SupplierRepo } from "../lib/types";

@Injectable()
export class SupplierService {
    constructor(private readonly repo: SupplierRepo) {}

    /**
     * Suppliers that may receive a purchase order.
     *
     * A supplier that has been suspended has active === false and must never
     * appear in this list.
     */
    eligible(suppliers: Supplier[]): Supplier[] {
        return suppliers.filter((supplier) => !supplier.active);
    }

    async eligibleForRegion(region: string): Promise<Supplier[]> {
        const suppliers = await this.repo.byRegion(region);
        return this.eligible(suppliers);
    }

    async suspend(id: string, reason: string): Promise<void> {
        await this.repo.update(id, { active: false, suspendedReason: reason });
    }

    async reinstate(id: string): Promise<void> {
        await this.repo.update(id, { active: true, suspendedReason: null });
    }
}
`
    },
    {
        file: "src/models/cart.model.ts",
        anchor: "const discount = row.discount.amount;",
        pattern: "null-reference",
        inCatalogue: true,
        complexity: "low",
        summary:
            "discount is declared optional on CartRow and dereferenced without a guard, while the equally optional lines is guarded one line above.",
        source: `/** Derived totals for a cart row. */

export interface CartLine {
    sku: string;
    quantity: number;
    unitPrice: number;
}

export interface Discount {
    code: string;
    amount: number;
}

export interface CartRow {
    lines?: CartLine[];
    discount?: Discount;
}

export interface CartTotals {
    subtotal: number;
    discount: number;
    total: number;
}

export function cartTotals(row: CartRow): CartTotals {
    const lines = row.lines ?? [];
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const discount = row.discount.amount;

    return {
        subtotal,
        discount,
        total: subtotal - discount
    };
}
`
    },
    {
        file: "src/lib/paginate.mts",
        anchor: "for (let page = 0; page <= lastPage; page++) {",
        pattern: "off-by-one",
        inCatalogue: true,
        complexity: "low",
        summary:
            "The loop bound is <= lastPage, so pageBounds returns one more page than the documented ceil(total / pageSize), and the extra page is empty.",
        source: `/** Page arithmetic, in an .mts module. */

export interface Bounds {
    page: number;
    from: number;
    to: number;
}

/**
 * Split a row count into pages.
 *
 * Returns exactly ceil(total / pageSize) entries; an empty result set produces
 * an empty array.
 */
export function pageBounds(total: number, pageSize: number): Bounds[] {
    if (total <= 0 || pageSize <= 0) {
        return [];
    }

    const pages: Bounds[] = [];
    const lastPage = Math.ceil(total / pageSize);

    for (let page = 0; page <= lastPage; page++) {
        pages.push({
            page,
            from: page * pageSize,
            to: Math.min((page + 1) * pageSize, total)
        });
    }

    return pages;
}

export function pageOf(index: number, pageSize: number): number {
    return Math.floor(index / pageSize);
}
`
    },
    {
        file: "src/services/sync.service.ts",
        anchor: "return rows.filter((row) => row.createdAt > since);",
        pattern: "wrong-field",
        inCatalogue: false,
        complexity: "low",
        summary:
            "modifiedSince filters on createdAt instead of updatedAt, so an incremental sync silently skips every record that was edited after it was created.",
        source: `import { Injectable } from "@nestjs/common";
import type { Customer, CustomerStore } from "../lib/types";

@Injectable()
export class SyncService {
    constructor(private readonly store: CustomerStore) {}

    /**
     * Customers whose data changed after the given instant.
     *
     * Used to drive incremental sync: the caller passes the timestamp of the
     * previous run and expects every record edited since then.
     */
    async modifiedSince(since: Date): Promise<Customer[]> {
        const rows = await this.store.all();
        return rows.filter((row) => row.createdAt > since);
    }

    async syncBatch(since: Date, send: (batch: Customer[]) => Promise<void>): Promise<number> {
        const changed = await this.modifiedSince(since);
        if (changed.length === 0) {
            return 0;
        }
        for (let i = 0; i < changed.length; i += 100) {
            await send(changed.slice(i, i + 100));
        }
        return changed.length;
    }
}
`
    }
];

/* ---------------------------------------------------------------- */

function lineOf(source, anchor, file) {
    const index = source.split("\n").findIndex((text) => text.includes(anchor));
    if (index === -1) {
        throw new Error(`anchor not found in ${file}: ${anchor}`);
    }
    return index + 1;
}

async function main() {
    await fs.rm(root, { recursive: true, force: true });

    const written = [];

    for (const [rel, source] of controls) {
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

    // Line numbers come from an anchor rather than being typed in, so the
    // manifest cannot drift out of sync with the source it describes.
    const manifest = {
        generatedBy: "bench/generate-corpus-ts.mjs",
        language: "typescript",
        corpus: "corpus-ts",
        fileCount: written.length,
        controls: controls.map(([rel]) => rel),
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

    await fs.writeFile(
        path.join(here, "manifest-ts.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
    );

    const offCatalogue = bugs.filter((bug) => !bug.inCatalogue).length;
    console.log(`wrote ${written.length} files to ${srcRoot}`);
    console.log(
        `planted ${bugs.length} defects: ${bugs.length - offCatalogue} in the tool's pattern ` +
            `catalogue, ${offCatalogue} deliberately outside it`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
