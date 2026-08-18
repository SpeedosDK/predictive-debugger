/** Application logic for Audit. */
class AuditService {
    constructor(repo, clock) {
        this.repo = repo;
        this.clock = clock;
    }

    async fetchOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        return { id, total };
    }

    async resolveInvoice(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        return { id, total };
    }

    async normaliseShipment(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        return { id, total };
    }

    async collectCustomer(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        return { id, total };
    }

    async reconcilePayment(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        return { id, total };
    }
}

module.exports = { AuditService };
