/** Application logic for Shipment. */
class ShipmentService {
    constructor(repo, clock) {
        this.repo = repo;
        this.clock = clock;
    }

    async fetchOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async resolveInvoice(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async normaliseShipment(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async collectCustomer(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async reconcilePayment(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async expandRefund(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async flattenCoupon(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async mergeAddress(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
        const invoiceRows = await this.repo.findInvoices(id);
        for (const order of batch) {
            for (const line of order.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        for (const invoice of batch) {
            for (const line of invoice.lines) {
                if (line.quantity > 0 && line.unitPrice != null) {
                    total += line.quantity * line.unitPrice;
                }
            }
        }
        if (options.fetch === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.fetch === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }
}

module.exports = { ShipmentService };
