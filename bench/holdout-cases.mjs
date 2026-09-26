import fs from "node:fs/promises";
import path from "node:path";

/**
 * Held-out cases: written and frozen before any run against them, and not used to tune prompts,
 * gates or grouping. Each bug is a pattern the development corpus does not contain in this form;
 * each control carries a surface cue a reviewer could mistake for one of those bugs.
 * Once measured, do not edit a case to make a model pass; add a new case instead.
 */
const sources = {
    // Bug: off() receives a new bound function, so the listener attached in attach() is never removed.
    "src/holdout/eventBridge.js": `/**
 * Forwards chat messages from a socket-like emitter to a handler.
 * After detach() the bridge must stop forwarding: the handler may already be disposed.
 */

class EventBridge {
    constructor(handler) {
        this.handler = handler;
        this.emitter = null;
        this.forwarded = 0;
    }

    onMessage(message) {
        this.forwarded += 1;
        this.handler.handle(message);
    }

    attach(emitter) {
        this.emitter = emitter;
        emitter.on("message", this.onMessage.bind(this));
    }

    detach() {
        if (!this.emitter) {
            return;
        }
        this.emitter.off("message", this.onMessage.bind(this));
        this.emitter = null;
    }

    stats() {
        return { attached: this.emitter !== null, forwarded: this.forwarded };
    }
}

module.exports = { EventBridge };
`,
    // Bug: read, await, write on shared state; concurrent take() calls both spend the same token.
    "src/holdout/tokenBucket.ts": `export interface BucketState {
    tokens: number;
    updatedAt: number;
}

export interface BucketStore {
    get(key: string): Promise<BucketState | undefined>;
    set(key: string, state: BucketState): Promise<void>;
}

/**
 * Per-client rate limiter used by the API gateway for every incoming request.
 * A client may make at most \`capacity\` requests per refill window.
 */
export class TokenBucket {
    constructor(
        private readonly store: BucketStore,
        private readonly capacity: number,
        private readonly refillPerSecond: number
    ) {}

    async take(clientId: string, now = Date.now()): Promise<boolean> {
        const state = (await this.store.get(clientId)) ?? { tokens: this.capacity, updatedAt: now };
        const elapsed = Math.max(0, now - state.updatedAt) / 1000;
        const tokens = Math.min(this.capacity, state.tokens + elapsed * this.refillPerSecond);
        if (tokens < 1) {
            await this.store.set(clientId, { tokens, updatedAt: now });
            return false;
        }
        await this.store.set(clientId, { tokens: tokens - 1, updatedAt: now });
        return true;
    }

    async remaining(clientId: string, now = Date.now()): Promise<number> {
        const state = await this.store.get(clientId);
        if (!state) {
            return this.capacity;
        }
        const elapsed = Math.max(0, now - state.updatedAt) / 1000;
        return Math.floor(Math.min(this.capacity, state.tokens + elapsed * this.refillPerSecond));
    }
}
`,
    // Bug: the comparator returns a boolean, never a negative number, so the order is wrong.
    "src/holdout/feed.js": `/** Builds the home feed: newest posts first, pinned posts above everything else. */

function byNewest(posts) {
    return [...posts].sort((a, b) => a.publishedAt < b.publishedAt);
}

function withPinned(posts) {
    const pinned = posts.filter((post) => post.pinned);
    const rest = posts.filter((post) => !post.pinned);
    return [...byNewest(pinned), ...byNewest(rest)];
}

function page(posts, cursor, size) {
    const start = cursor ? posts.findIndex((post) => post.id === cursor) + 1 : 0;
    return posts.slice(start, start + size);
}

module.exports = { byNewest, withPinned, page };
`,
    // Bug: for...in yields string keys, so rank becomes "01", "11", ... instead of 1, 2, ...
    "src/holdout/leaderboard.js": `/**
 * Leaderboard rows for the weekly challenge.
 * \`rank\` is a 1-based number; clients sort and compare it numerically.
 */

function rankRows(entries) {
    const sorted = [...entries].sort((a, b) => b.points - a.points);
    const rows = [];
    for (const index in sorted) {
        const entry = sorted[index];
        rows.push({ rank: index + 1, user: entry.user, points: entry.points });
    }
    return rows;
}

function topThree(entries) {
    return rankRows(entries).slice(0, 3);
}

function totalPoints(entries) {
    return entries.reduce((sum, entry) => sum + entry.points, 0);
}

module.exports = { rankRows, topThree, totalPoints };
`,
    // Bug: a rejected ping inside the interval callback is never caught; markUnhealthy never runs.
    "src/holdout/heartbeat.js": `/**
 * Keeps a connection's health flag current. A failed ping must mark the
 * connection unhealthy so the pool stops handing it out.
 */

class Heartbeat {
    constructor(client, intervalMs = 5000) {
        this.client = client;
        this.intervalMs = intervalMs;
        this.healthy = true;
        this.timer = null;
    }

    start() {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(async () => {
            await this.client.ping();
            this.healthy = true;
        }, this.intervalMs);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    markUnhealthy() {
        this.healthy = false;
    }
}

module.exports = { Heartbeat };
`,
    // Bug: slice start is one too early, so lastN returns n + 1 items.
    "src/holdout/recent.ts": `export interface Visit {
    path: string;
    at: number;
}

/** The \`n\` most recent visits, oldest first. \`visits\` is in chronological order. */
export function lastN(visits: readonly Visit[], n: number): Visit[] {
    if (n <= 0) {
        return [];
    }
    return visits.slice(Math.max(0, visits.length - n - 1));
}

/** Distinct paths, in order of first visit. */
export function distinctPaths(visits: readonly Visit[]): string[] {
    return [...new Set(visits.map((visit) => visit.path))];
}

/** Visits at or after \`since\`. */
export function since(visits: readonly Visit[], since: number): Visit[] {
    return visits.filter((visit) => visit.at >= since);
}
`,
    // Control: fire-and-forget async forEach, documented as such, with every failure handled.
    "src/holdout/notifier.js": `/**
 * Best-effort notifications. Delivery is deliberately not awaited: callers
 * never wait on or inspect it, and each failure is logged, not thrown.
 */

function notifyAll(subscribers, message, send, log) {
    subscribers.forEach(async (subscriber) => {
        try {
            await send(subscriber.address, message);
        } catch (error) {
            log.warn("notification failed", { subscriber: subscriber.id, error: String(error) });
        }
    });
    return subscribers.length;
}

module.exports = { notifyAll };
`,
    // Control: read, await, write, but serialized per key through a promise chain.
    "src/holdout/quota.ts": `export interface QuotaStore {
    used(account: string): Promise<number>;
    setUsed(account: string, value: number): Promise<void>;
}

/** Monthly upload quota. Calls for one account are applied one at a time, in arrival order. */
export class Quota {
    private readonly queues = new Map<string, Promise<unknown>>();

    constructor(private readonly store: QuotaStore, private readonly limit: number) {}

    consume(account: string, bytes: number): Promise<boolean> {
        const previous = this.queues.get(account) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(async () => {
            const used = await this.store.used(account);
            if (used + bytes > this.limit) {
                return false;
            }
            await this.store.setUsed(account, used + bytes);
            return true;
        });
        this.queues.set(account, next);
        void next.finally(() => {
            if (this.queues.get(account) === next) {
                this.queues.delete(account);
            }
        }).catch(() => undefined);
        return next;
    }
}
`,
    // Control: an inclusive loop bound that the documentation asks for.
    "src/holdout/range.js": `/** Calendar helpers. Ranges are inclusive of both \`from\` and \`to\`. */

function daysBetween(from, to) {
    const days = [];
    for (let day = from; day <= to; day++) {
        days.push(day);
    }
    return days;
}

function countDays(from, to) {
    return to < from ? 0 : to - from + 1;
}

module.exports = { daysBetween, countDays };
`,
    // Control: numeric comparators and a locale comparison, all correct.
    "src/holdout/sortUsers.ts": `export interface User {
    name: string;
    createdAt: Date;
    score: number;
}

/** Newest accounts first. */
export function newestFirst(users: readonly User[]): User[] {
    return [...users].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Alphabetical by display name, case-insensitive. */
export function byName(users: readonly User[]): User[] {
    return [...users].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Highest score first; ties keep their existing order. */
export function byScore(users: readonly User[]): User[] {
    return [...users].sort((a, b) => b.score - a.score);
}
`,
    // Written as a control; discovered defect (see below). Kept unchanged.
    "src/holdout/poller.ts": `export interface Source {
    fetch(): Promise<string[]>;
}

/** Polls a source and keeps the latest successful result. Failures keep the previous result. */
export class Poller {
    private timer: ReturnType<typeof setInterval> | undefined;
    private latest: string[] = [];
    private failures = 0;

    constructor(private readonly source: Source, private readonly intervalMs: number) {}

    start(): void {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            this.source.fetch().then(
                (items) => { this.latest = items; this.failures = 0; },
                () => { this.failures += 1; }
            );
        }, this.intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    snapshot(): { items: string[]; failures: number } {
        return { items: [...this.latest], failures: this.failures };
    }
}
`,
    // Control: optional fields are guarded; the required field is dereferenced directly, correctly.
    "src/holdout/profile.ts": `export interface Address {
    city: string;
    country: string;
}

export interface Profile {
    name: string;
    address?: Address;
    theme?: "light" | "dark";
}

export function headline(profile: Profile): string {
    const city = profile.address?.city ?? "unknown";
    return \`\${profile.name.trim()} (\${city})\`;
}

export function theme(profile: Profile): "light" | "dark" {
    return profile.theme ?? "light";
}
`
};

const bugs = [
    { file: "src/holdout/eventBridge.js", pattern: "resource-leak", anchor: 'this.emitter.off("message", this.onMessage.bind(this));',
        from: 'emitter.on("message", this.onMessage.bind(this));', to: "this.emitter = null;\n    }",
        summary: "detach() passes a new bound function to off(), so the listener from attach() is never removed and messages keep being forwarded." },
    { file: "src/holdout/tokenBucket.ts", pattern: "race-condition", anchor: "const state = (await this.store.get(clientId))",
        from: "async take(", to: "return true;",
        summary: "take() reads the bucket, awaits, then writes a value from that read; concurrent requests spend the same token and exceed capacity." },
    { file: "src/holdout/feed.js", pattern: "other", anchor: "a.publishedAt < b.publishedAt", from: "function byNewest", to: "a.publishedAt < b.publishedAt",
        summary: "The sort comparator returns a boolean, never a negative number, so posts are not reliably newest first." },
    { file: "src/holdout/leaderboard.js", pattern: "other", anchor: "rank: index + 1", from: "for (const index in sorted)", to: "rank: index + 1",
        summary: "for...in yields string keys, so rank is the string \"01\", \"11\", ... instead of the number 1, 2, ..." },
    { file: "src/holdout/heartbeat.js", pattern: "unhandled-error", anchor: "await this.client.ping();", from: "this.timer = setInterval", to: "}, this.intervalMs);",
        summary: "A rejected ping is never caught: the health flag is never cleared and the rejection is unhandled." },
    // Written as a clean control. On the first run all three CLIs found a real race that its author
    // missed: the interval does not wait for the previous fetch, so a slow earlier fetch can resolve
    // last and overwrite newer items. Reclassified, as invoice.entity.ts was in the TS corpus.
    { file: "src/holdout/poller.ts", pattern: "race-condition", discovered: true,
        anchor: "(items) => { this.latest = items; this.failures = 0; },", from: "this.timer = setInterval", to: "}, this.intervalMs);",
        summary: "Overlapping interval fetches can resolve out of order; an older result overwrites a newer one." },
    { file: "src/holdout/recent.ts", pattern: "off-by-one", anchor: "visits.length - n - 1", from: "visits.length - n - 1", to: "visits.length - n - 1",
        summary: "lastN starts the slice one element early and returns n + 1 visits." }
];

const controls = ["src/holdout/notifier.js", "src/holdout/quota.ts", "src/holdout/range.js",
    "src/holdout/sortUsers.ts", "src/holdout/profile.ts"];

function lineOf(source, anchor, file) {
    const index = source.indexOf(anchor);
    if (index === -1 || source.indexOf(anchor, index + 1) !== -1) throw new Error(`Anchor must occur once in ${file}: ${anchor}`);
    return source.slice(0, index).split("\n").length;
}

export async function writeHoldoutCases(root) {
    for (const [name, source] of Object.entries(sources)) {
        const file = path.join(root, name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, source, "utf8");
    }
    return {
        fileCount: Object.keys(sources).length,
        note: "Held out: frozen before any run and not used for tuning. Add cases rather than editing measured ones.",
        bugs: bugs.map(({ anchor, from, to, ...rest }) => {
            const source = sources[rest.file];
            const line = lineOf(source, anchor, rest.file);
            const range = [lineOf(source, from, rest.file), lineOf(source, to, rest.file)];
            return { ...rest, line, acceptableLines: [line], acceptableRanges: [[Math.min(...range), Math.max(...range)]], anchor };
        }),
        controls
    };
}
