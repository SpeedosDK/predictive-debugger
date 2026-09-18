/**
 * Executes the adversarial cases to prove the answer key rather than asserting it.
 *
 * Every other label in this corpus is a human claim about source. These cases exist to
 * create a negative class, so a control that is quietly buggy would poison the ranking
 * measurement in the one direction the experiment cannot detect on its own -- the scorer
 * would be marked wrong for being right. Where the defect is observable at runtime, the
 * test observes it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const corpus = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus/src/adversarial');
const load = name => require(path.join(corpus, name));

test('bounded-lookahead: last tier prices instead of throwing', () => {
    const { rateFor } = load('bounded-lookahead.js');
    const tiers = [{ minQuantity: 0, rate: 10 }, { minQuantity: 10, rate: 8 }, { minQuantity: 100, rate: 5 }];
    assert.equal(rateFor(tiers, 5), 10);
    assert.equal(rateFor(tiers, 50), 8);
    assert.equal(rateFor(tiers, 1000), 5);
    assert.equal(rateFor([], 5), 0);
});

test('checked-divisor: no division by zero', () => {
    const { averageOrderValue } = load('checked-divisor.js');
    assert.equal(averageOrderValue([]), 0);
    assert.equal(averageOrderValue([{ status: 'open', amountCents: 500 }]), 0);
    assert.equal(averageOrderValue([{ status: 'settled', amountCents: 300 },
        { status: 'settled', amountCents: 500 }, { status: 'open', amountCents: 999 }]), 400);
});

test('preset-index: every key read was written first', () => {
    const { summarise } = load('preset-index.js');
    assert.deepEqual(summarise([{ id: 'a', amount: 2 }, { id: 'a', amount: 3 }, { id: 'b', amount: 1 }]),
        [{ id: 'a', total: 5 }, { id: 'b', total: 1 }]);
});

test('validated-index: rejects out-of-range and non-numeric input', () => {
    const { pageAt } = load('validated-index.js');
    const pages = [{ rows: ['a'] }, { rows: ['b'] }];
    assert.deepEqual(pageAt(pages, '1'), ['b']);
    for (const bad of ['9', '-1', 'abc', '', null]) assert.equal(pageAt(pages, bad), null);
});

test('empty-rows: empty input returns a header instead of throwing', () => {
    const { headerFor } = load('empty-rows.js');
    assert.deepEqual(headerFor([]), { columns: [], generatedAt: null });
    assert.deepEqual(headerFor([{ id: 1, capturedAt: 'now' }]).columns, ['id', 'capturedAt']);
});

test('optional-chain: every missing hop falls through to the default', () => {
    const { shippingCity } = load('optional-chain.js');
    assert.equal(shippingCity(undefined), 'unknown');
    assert.equal(shippingCity({}), 'unknown');
    assert.equal(shippingCity({ customer: { addresses: {} } }), 'unknown');
    assert.equal(shippingCity({ customer: { addresses: { shipping: { city: 'Oslo' } } } }), 'Oslo');
});

test('guarded-profile: the guard covers every hop it dereferences', () => {
    const { displayName } = load('guarded-profile.js');
    assert.equal(displayName(null), 'Guest');
    assert.equal(displayName({}), 'Guest');
    // The first version of this control guarded session and session.user but not
    // displayName, so a user without one threw. The detector caught it; the test had not.
    assert.equal(displayName({ user: {} }), 'Guest');
    assert.equal(displayName({ user: { displayName: 42 } }), 'Guest');
    assert.match(displayName({ user: { displayName: ' Ada ' }, joinedAt: new Date(0) }), /^Ada \(since /);
});

test('deep-clone-config is clean and shallow-overrides mutates the caller', () => {
    const base = () => ({ retry: { attempts: 3, backoffMs: 100 } });
    const clean = load('deep-clone-config.js');
    const original = base();
    clean.withOverrides(original, { attempts: 9 });
    assert.equal(original.retry.attempts, 3, 'deep clone must leave the caller untouched');

    const buggy = load('shallow-overrides.js');
    const shared = base();
    buggy.withOverrides(shared, { attempts: 9 });
    assert.equal(shared.retry.attempts, 9, 'planted defect: spread copies only the top level');

    // Both variants defaulted a missing retry section only after the detector found that
    // neither did. The pair must differ in copy depth alone, not in what it tolerates.
    assert.equal(clean.withOverrides({}, { attempts: 2 }).retry.attempts, 2);
    assert.equal(buggy.withOverrides({}, { attempts: 2 }).retry.attempts, 2);
    // A weaker detector flagged the clean variant for throwing on a null config; it did.
    assert.equal(clean.withOverrides(null, { attempts: 2 }).retry.attempts, 2);
});

test('copied-sort is clean and in-place-sort reorders the caller', () => {
    const rows = () => [{ volume: 1 }, { volume: 9 }, { volume: 5 }];
    const clean = load('copied-sort.js');
    const untouched = rows();
    clean.topSuppliers(untouched, 2);
    assert.deepEqual(untouched.map(r => r.volume), [1, 9, 5], 'copy must preserve caller order');

    const buggy = load('in-place-sort.js');
    const mutated = rows();
    buggy.topSuppliers(mutated, 2);
    assert.deepEqual(mutated.map(r => r.volume), [9, 5, 1], 'planted defect: sort mutates in place');
});

test('integer-cents is exact and float-cents fails on equal amounts', () => {
    const clean = load('integer-cents.js');
    assert.equal(clean.isSettled({ lines: [{ amountCents: 10 }, { amountCents: 20 }],
        payments: [{ amountCents: 30 }] }), true);

    const buggy = load('float-cents.js');
    // 0.1 + 0.2 !== 0.3 in binary floating point; the invoice is settled and the check says otherwise.
    assert.equal(buggy.isSettled({ lines: [{ amount: 0.1 }, { amount: 0.2 }],
        payments: [{ amount: 0.3 }] }), false, 'planted defect: float equality on currency');
});

test('var-capture: every callback sees the final counter', () => {
    const { scheduleReminders } = load('var-capture.js');
    const scheduled = [];
    const seen = [];
    scheduleReminders(['a', 'b', 'c'], (fn) => scheduled.push(fn), (value) => seen.push(value));
    scheduled.forEach(fn => fn());
    assert.deepEqual(seen, [undefined, undefined, undefined], 'planted defect: var is function-scoped');
});

test('filtered-average: divisor counts orders the total excluded', () => {
    const { averageOrderValue } = load('filtered-average.js');
    const orders = [{ status: 'settled', amountCents: 300 }, { status: 'open', amountCents: 900 }];
    // Only the settled 300 is summed, then divided by 2.
    assert.equal(averageOrderValue(orders), 150, 'planted defect: filtered total over unfiltered count');
});

test('sequential-reserve: awaits every line and cannot oversell under concurrency', async () => {
    const { Reserver } = load('sequential-reserve.js');
    // A store whose conditional decrement is atomic, which is the contract the control relies on.
    const makeRepo = (initial) => {
        const stock = new Map(Object.entries(initial));
        return { seen: [], async decrementIfAvailable(sku, qty) {
            await new Promise(r => setImmediate(r));
            const held = stock.get(sku) ?? 0;
            if (held < qty) return false;
            stock.set(sku, held - qty);
            this.seen.push([sku, qty]);
            return true;
        }, stock };
    };

    const repo = makeRepo({ a: 100, b: 100 });
    const result = await new Reserver(repo, { warn() {} })
        .reserve('o1', [{ sku: 'a', quantity: 1 }, { sku: 'b', quantity: 2 }]);
    assert.deepEqual(result.reserved, ['a', 'b']);
    assert.deepEqual(repo.seen, [['a', 1], ['b', 2]], 'all work completes before reserve resolves');

    // The first version of this control read availability and then decremented, so two
    // concurrent callers both passed the check and oversold to -5. The detector reported
    // that race and was right; the test only checked that awaits completed.
    const contended = makeRepo({ a: 5 });
    const reserver = new Reserver(contended, { warn() {} });
    const [first, second] = await Promise.all([
        reserver.reserve('o1', [{ sku: 'a', quantity: 5 }]),
        reserver.reserve('o2', [{ sku: 'a', quantity: 5 }])
    ]);
    assert.equal(contended.stock.get('a'), 0, 'stock must never go negative');
    assert.equal(first.reserved.length + second.reserved.length, 1, 'exactly one order gets the stock');
});

test('closed-handle closes on success and on failure; unawaited-close does not wait', async () => {
    const handleFor = (closed) => ({
        append: async () => {}, flush: async () => {},
        close: async () => { await new Promise(r => setImmediate(r)); closed.push('closed'); }
    });
    const clean = load('closed-handle.js');
    const closed = [];
    await new clean.ExportWriter({ open: async () => handleFor(closed) }).write('x', [{ a: 1 }]);
    assert.deepEqual(closed, ['closed'], 'await in finally means the close completed');

    const buggy = load('unawaited-close.js');
    const late = [];
    await new buggy.ExportWriter({ open: async () => handleFor(late) }).write('x', [{ a: 1 }]);
    assert.deepEqual(late, [], 'planted defect: write resolved before close finished');
});

test('locked-balance: concurrent ticks serialise instead of losing an update', async () => {
    const { LedgerTick } = load('locked-balance.js');
    // A real per-key lock: each acquire waits on the previous holder's release.
    const chains = new Map();
    let held = 0, maxHeld = 0;
    const locks = { acquire: async (id) => {
        let release;
        const mine = new Promise(resolve => { release = resolve; });
        const previous = chains.get(id) ?? Promise.resolve();
        chains.set(id, previous.then(() => mine));
        await previous;
        held++; maxHeld = Math.max(maxHeld, held);
        return () => { held--; release(); };
    } };
    const store = new Map([['a', 10]]);
    const ledger = {
        // Yield between read and write, the window a lost update would exploit.
        balanceOf: async (id) => { await new Promise(r => setImmediate(r)); return store.get(id); },
        write: async (id, value) => { store.set(id, value); }
    };
    const tick = new LedgerTick(ledger, locks);
    await Promise.all([
        tick.settle({ id: 'a' }, [{ amount: 5 }]),
        tick.settle({ id: 'a' }, [{ amount: 5 }])
    ]);
    assert.equal(maxHeld, 1, 'the critical section is never entered concurrently');
    assert.equal(held, 0, 'every acquire is released');
    assert.equal(store.get('a'), 20, 'both increments survive; neither tick lost the other');
});
