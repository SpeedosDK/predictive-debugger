import { Injectable } from "@nestjs/common";
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
