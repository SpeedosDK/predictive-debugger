/** Balance adjustment serialised by an explicit per-account lock. */

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
