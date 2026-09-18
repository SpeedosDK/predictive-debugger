/** Stock reservation that awaits every line and decrements atomically. */

class Reserver {
    constructor(repo, logger) {
        this.repo = repo;
        this.logger = logger;
    }

    async reserve(orderId, lines) {
        const reserved = [];
        for (const line of lines) {
            // Conditional decrement in the store: there is no window between
            // deciding there is stock and taking it.
            const taken = await this.repo.decrementIfAvailable(line.sku, line.quantity);
            if (taken) {
                reserved.push(line.sku);
            } else {
                this.logger.warn("insufficient stock", { sku: line.sku });
            }
        }
        return { orderId, reserved };
    }
}

module.exports = { Reserver };
