import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { ReconciliationWorker } = require('./corpus/src/workers/reconciliationWorker.js');

test('partial backfill discards the opening balance', async () => {
    let balance = 105;
    const worker = new ReconciliationWorker({ findPayments: async () => [{ id: 'a' }] }, {
        entriesSince: async () => [{ kind: 'credit', amount: 5 }],
        balanceOf: async () => balance,
        write: async (_id, value) => { balance = value; }
    }, {});
    assert.deepEqual(await worker.backfill(10), { repaired: 1 });
    assert.equal(balance, 5);
});

test('money rounding drops a decimal half-cent because of binary multiplication', () => {
    const ts = require('typescript');
    const source = readFileSync(new URL('./corpus-ts/src/lib/money.ts', import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
    const exports = {};
    vm.runInNewContext(outputText, { exports });
    assert.equal(exports.roundMoney(1.005), 1);
    assert.equal(exports.roundMoney(1.015), 1.01);
});

test('header lookup misses a permitted mixed-case header key', () => {
    const ts = require('typescript');
    const source = readFileSync(new URL('./corpus-ts/src/lib/headers.mts', import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
    const exports = {};
    vm.runInNewContext(outputText, { exports });
    assert.equal(exports.contentType({ 'content-type': 'application/json' }), 'application/json');
    assert.equal(exports.contentType({ 'Content-Type': 'application/json' }), null);
});

test('a tick between balance write and cursor update applies a settlement twice', async () => {
    let balance = 0, overlapped = false;
    const account = { id: 'a', lastSeenAt: 0 };
    const worker = new ReconciliationWorker({
        findPayments: async () => [account],
        settledSince: async (_id, since) => since === 0 ? [{ status: 'settled', amount: 5 }] : [],
        markSeen: async (_id, time) => { account.lastSeenAt = time; }
    }, {
        balanceOf: async () => balance,
        write: async (_id, value) => {
            balance = value;
            if (!overlapped) { overlapped = true; await worker.tick(); }
        }
    }, {});
    await worker.tick();
    assert.equal(balance, 10);
});

// These tests verify additional findings in the frozen benchmark corpus, not product behavior.
test('reconciliation watermark skips a payment arriving after the read', async t => {
    t.mock.method(Date, 'now', () => 20);
    const account = { id: 'a', lastSeenAt: 0 };
    const payments = [{ time: 10, status: 'settled', amount: 5 }];
    let balance = 0;
    const worker = new ReconciliationWorker({
        findPayments: async () => [account],
        settledSince: async (_id, since) => payments.filter(p => p.time > since),
        markSeen: async (_id, time) => { account.lastSeenAt = time; }
    }, {
        balanceOf: async () => balance,
        write: async (_id, value) => {
            balance = value;
            if (payments.length === 1) payments.push({ time: 15, status: 'settled', amount: 7 });
        }
    }, {});
    await worker.tick();
    await worker.tick();
    assert.equal(balance, 5);
    assert.equal(payments.reduce((sum, p) => sum + p.amount, 0), 12);
    assert.equal(account.lastSeenAt, 20);
});

test('reconciliation report treats a reversal oppositely to tick', async () => {
    let balance = 0;
    const worker = new ReconciliationWorker({
        findPayments: async () => [{ id: 'a', lastSeenAt: 0 }],
        settledSince: async () => [{ status: 'reversed', amount: 5 }],
        markSeen: async () => {}
    }, {
        balanceOf: async () => balance,
        write: async (_id, value) => { balance = value; }
    }, {});
    await worker.tick();
    const [report] = await worker.report({ from: 0 });
    assert.equal(balance, -5);
    assert.equal(report.net, 5);
    assert.equal(report.debits, 0);
});
