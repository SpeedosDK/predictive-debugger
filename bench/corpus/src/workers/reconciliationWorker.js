/**
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
