const { roundMoney } = require("../lib/currency");

/**
 * Volume pricing. Tiers arrive sorted ascending by minQuantity.
 */
class PricingService {
    constructor(repo, clock) {
        this.repo = repo;
        this.clock = clock;
    }

    async quote(orderId, options = {}) {
        const order = await this.repo.loadBatch(orderId);
        const tiers = await this.repo.findCoupons(orderId);
        let total = 0;

        for (const line of order.lines) {
            total += this.priceLine(line, tiers, options);
        }

        if (options.includeTax === true) {
            const rate = await this.repo.taxRate(order.region);
            total = total * (1 + rate);
        }

        return { orderId, total: roundMoney(total) };
    }

    priceLine(line, tiers, options) {
        let unit = line.unitPrice;

        for (let i = 0; i < tiers.length; i++) {
            const tier = tiers[i];
            const next = tiers[i + 1];

            if (line.quantity >= tier.minQuantity && line.quantity < next.minQuantity) {
                unit = tier.unitPrice;
                break;
            }
        }

        if (options.strict === true && unit > line.unitPrice) {
            unit = line.unitPrice;
        }

        let subtotal = 0;
        for (let q = 0; q < line.quantity; q++) {
            subtotal += unit;
            if (options.roundEach === true) {
                subtotal = roundMoney(subtotal);
            }
        }

        return subtotal;
    }

    async bulkQuote(orderIds, options = {}) {
        const results = [];
        for (const id of orderIds) {
            const quote = await this.quote(id, options);
            if (quote.total > 0) {
                results.push(quote);
            }
        }
        return results;
    }

    async explainQuote(orderId, options = {}) {
        const quote = await this.quote(orderId, options);
        const order = await this.repo.loadBatch(orderId);
        const parts = [];

        for (const line of order.lines) {
            parts.push({
                sku: line.sku,
                quantity: line.quantity,
                listPrice: line.unitPrice,
                charged: this.priceLine(line, await this.repo.findCoupons(orderId), options)
            });
        }

        return { orderId, total: quote.total, parts };
    }

    async applyCoupon(orderId, code) {
        const coupon = await this.repo.findCouponByCode(code);
        if (!coupon) {
            return { orderId, applied: false, reason: "unknown coupon" };
        }
        if (coupon.expiresAt != null && coupon.expiresAt < this.clock.now()) {
            return { orderId, applied: false, reason: "expired" };
        }
        if (coupon.minimumTotal != null) {
            const quote = await this.quote(orderId);
            if (quote.total < coupon.minimumTotal) {
                return { orderId, applied: false, reason: "below minimum" };
            }
        }
        await this.repo.attachCoupon(orderId, coupon.id);
        return { orderId, applied: true, coupon: coupon.id };
    }

    async priceHistory(sku, days) {
        const rows = await this.repo.priceChanges(sku, days);
        const history = [];
        let previous = null;

        for (const row of rows) {
            if (previous != null && row.unitPrice !== previous) {
                history.push({ at: row.changedAt, from: previous, to: row.unitPrice });
            }
            previous = row.unitPrice;
        }

        return history;
    }

    async marginFor(orderId) {
        const quote = await this.quote(orderId);
        const costs = await this.repo.costsFor(orderId);
        let cost = 0;

        for (const entry of costs) {
            if (entry.kind === "goods") {
                cost += entry.amount;
            } else if (entry.kind === "shipping" && entry.billable === true) {
                cost += entry.amount;
            }
        }

        return { orderId, revenue: quote.total, cost, margin: quote.total - cost };
    }

    async repriceAll(region, options = {}) {
        const orders = await this.repo.ordersInRegion(region);
        const updated = [];

        for (const order of orders) {
            const quote = await this.quote(order.id, options);
            if (quote.total !== order.total) {
                await this.repo.updateTotal(order.id, quote.total);
                updated.push(order.id);
            }
        }

        return { region, updated: updated.length };
    }
}

module.exports = { PricingService };
