/**
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
        throw new Error(`cannot add ${a.currency} to ${b.currency}`);
    }
    return { amount: roundMoney(a.amount + b.amount), currency: a.currency };
}

export function format(money: Money | null | undefined): string {
    if (!money) {
        return "-";
    }
    return `${roundMoney(money.amount).toFixed(2)} ${money.currency}`;
}

export function isPositive(money: Money | null | undefined): boolean {
    return money !== null && money !== undefined && money.amount > 0;
}
