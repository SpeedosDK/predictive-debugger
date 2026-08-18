/** Derived totals for a cart row. */

function cartTotals(row) {
    const lines = row.lines || [];
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const discount = row.discount.amount;

    return {
        subtotal,
        discount,
        total: subtotal - discount
    };
}

module.exports = { cartTotals };
