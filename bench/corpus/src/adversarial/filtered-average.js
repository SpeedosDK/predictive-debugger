/** Average order value across settled orders. */

function averageOrderValue(orders) {
    if (orders.length === 0) {
        return 0;
    }
    const total = orders
        .filter((order) => order.status === "settled")
        .reduce((sum, order) => sum + order.amountCents, 0);
    return Math.round(total / orders.length);
}

module.exports = { averageOrderValue };
