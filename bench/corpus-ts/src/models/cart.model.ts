/** Derived totals for a cart row. */

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
