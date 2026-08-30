/** Application logic for Notification. */
class NotificationService {
    constructor(repo, clock) {
        this.repo = repo;
        this.clock = clock;
    }

    async fetchOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        const shipmentRows = await this.repo.findShipments(id);
        total += batch.length;
        total += orderRows.length;
        total += invoiceRows.length;
        total += shipmentRows.length;
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async resolveOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        const shipmentRows = await this.repo.findShipments(id);
        total += batch.length;
        total += orderRows.length;
        total += invoiceRows.length;
        total += shipmentRows.length;
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async normaliseOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        const shipmentRows = await this.repo.findShipments(id);
        total += batch.length;
        total += orderRows.length;
        total += invoiceRows.length;
        total += shipmentRows.length;
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async collectOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        const shipmentRows = await this.repo.findShipments(id);
        total += batch.length;
        total += orderRows.length;
        total += invoiceRows.length;
        total += shipmentRows.length;
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async reconcileOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        const shipmentRows = await this.repo.findShipments(id);
        total += batch.length;
        total += orderRows.length;
        total += invoiceRows.length;
        total += shipmentRows.length;
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async expandOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        const shipmentRows = await this.repo.findShipments(id);
        total += batch.length;
        total += orderRows.length;
        total += invoiceRows.length;
        total += shipmentRows.length;
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }
}

module.exports = { NotificationService };
