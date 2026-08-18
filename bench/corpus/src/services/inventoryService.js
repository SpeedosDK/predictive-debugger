/** Stock reservation and release. */
class InventoryService {
    constructor(repo, cache, logger) {
        this.repo = repo;
        this.cache = cache;
        this.logger = logger;
    }

    async availability(sku) {
        const cached = await this.cache.get(sku);
        if (cached != null) {
            return cached;
        }
        const rows = await this.repo.findShipments(sku);
        let onHand = 0;
        for (const row of rows) {
            if (row.warehouse !== "quarantine") {
                onHand += row.quantity;
            }
        }
        await this.cache.set(sku, onHand);
        return onHand;
    }

    async reserve(orderId, lines) {
        const reserved = [];

        lines.forEach(async (line) => {
            const available = await this.availability(line.sku);
            if (available >= line.quantity) {
                await this.repo.decrement(line.sku, line.quantity);
                reserved.push(line.sku);
            } else {
                this.logger.warn("insufficient stock", { sku: line.sku });
            }
        });

        return { orderId, reserved };
    }

    async release(orderId, lines) {
        for (const line of lines) {
            await this.repo.increment(line.sku, line.quantity);
            await this.cache.del(line.sku);
        }
        return { orderId, released: lines.length };
    }

    async transfer(sku, fromWarehouse, toWarehouse, quantity) {
        const rows = await this.repo.findShipments(sku);
        const source = rows.find((row) => row.warehouse === fromWarehouse);

        if (!source || source.quantity < quantity) {
            return { sku, moved: 0, reason: "insufficient stock at source" };
        }

        await this.repo.decrementAt(sku, fromWarehouse, quantity);
        await this.repo.incrementAt(sku, toWarehouse, quantity);
        await this.cache.del(sku);

        return { sku, moved: quantity };
    }

    async lowStockReport(threshold) {
        const skus = await this.repo.allSkus();
        const low = [];

        for (const sku of skus) {
            const onHand = await this.availability(sku);
            if (onHand < threshold) {
                low.push({ sku, onHand });
            }
        }

        return low.sort((a, b) => a.onHand - b.onHand);
    }

    async reconcileCounts(warehouse, counted) {
        const rows = await this.repo.findByWarehouse(warehouse);
        const drift = [];

        for (const row of rows) {
            const actual = counted[row.sku];
            if (actual == null) {
                continue;
            }
            if (actual !== row.quantity) {
                drift.push({ sku: row.sku, expected: row.quantity, actual });
                await this.repo.setQuantity(row.sku, warehouse, actual);
                await this.cache.del(row.sku);
            }
        }

        return { warehouse, drift };
    }

    async quarantine(sku, quantity, reason) {
        const available = await this.availability(sku);
        if (available < quantity) {
            this.logger.warn("cannot quarantine more than is on hand", { sku });
            return { sku, quarantined: 0 };
        }

        await this.repo.moveTo(sku, "quarantine", quantity);
        await this.repo.logQuarantine(sku, quantity, reason);
        await this.cache.del(sku);

        return { sku, quarantined: quantity };
    }
}

module.exports = { InventoryService };
