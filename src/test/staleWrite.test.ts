import assert from "node:assert/strict";
import { test } from "node:test";
import { hasReadAwaitWrite } from "../core/analysis/staleWrite";

test("flags an awaited read followed by an awaited write in one async function", async () => {
    assert.equal(await hasReadAwaitWrite(
        "async function take(k) { const s = (await store.get(k)) ?? {}; await store.set(k, { n: s.n - 1 }); }"), true);
    assert.equal(await hasReadAwaitWrite(
        "class A { async tick() { const b = await this.ledger.balanceOf(1); await this.ledger.setBalance(1, b + 1); } }"), true);
});

test("does not flag reads without writes, writes before reads, sync code or a lone read-write call", async () => {
    for (const code of [
        "async function f(k) { const s = await store.get(k); return s; }",
        "async function f(k) { await store.set(k, 1); const s = await store.get(k); return s; }",
        "function f(k) { const s = store.get(k); store.set(k, s + 1); }",
        "async function f(k) { const s = await store.update(k, 1); return s; }",
        "not javascript {{{"
    ]) assert.equal(await hasReadAwaitWrite(code), false, code);
});

test("a write in a nested function does not pair with the outer read", async () => {
    assert.equal(await hasReadAwaitWrite(
        "async function f(k) { const s = await store.get(k); return async () => { await store.set(k, s); }; }"), false);
});

test("an await anywhere in the initializer counts as the read", async () => {
    assert.equal(await hasReadAwaitWrite(
        "async function f(k) { const s = cache[k] || await store.get(k); await store.set(k, s + 1); }"), true);
    assert.equal(await hasReadAwaitWrite(
        "async function f(k) { const s = { v: await store.get(k) }; await store.set(k, s.v + 1); }"), true);
});
