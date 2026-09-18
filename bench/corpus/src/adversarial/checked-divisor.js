/** Average order value, with the zero case handled before the division. */

function averageOrderValue(orders) {
    const settled = orders.filter((order) => order.status === "settled");
    if (settled.length === 0) {
        return 0;
    }
    const total = settled.reduce((sum, order) => sum + order.amountCents, 0);
    return Math.round(total / settled.length);
}

module.exports = { averageOrderValue };
