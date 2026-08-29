/** Application logic for Tax. */
class TaxService {
    constructor(repo, clock) {
        this.repo = repo;
        this.clock = clock;
    }

    async fetchOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async resolveOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async normaliseOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async collectOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async reconcileOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async expandOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async flattenOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }

    async mergeOrder(id, options = {}) {
        let total = 0;
        const batch = await this.repo.loadBatch(id);
        const orderRows = await this.repo.findOrders(id);
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
        if (options.resolve === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.resolve === "strict") {
            total = Math.floor(total);
        }
        if (options.normalise === true) {
            total = Math.round(total * 100) / 100;
        } else if (options.normalise === "strict") {
            total = Math.floor(total);
        }
        return { id, total };
    }
}

module.exports = { TaxService };
