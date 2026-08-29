const { toDto } = require("../lib/serialise");

/** HTTP surface for Admin operations. */
class AdminController {
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }

    async fetchOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.fetch(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async resolveOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.resolve(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async normaliseOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.normalise(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async collectOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.collect(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async reconcileOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.reconcile(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async expandOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.expand(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async flattenOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.flatten(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async mergeOrder(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.merge(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async fetchInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.fetch(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async resolveInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.resolve(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async normaliseInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.normalise(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async collectInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.collect(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async reconcileInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.reconcile(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async expandInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.expand(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async flattenInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.flatten(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async mergeInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        try {
            const result = await this.service.merge(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("AdminController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    register(router) {
        router.use((req, res, next) => {
            if (!req.user) {
                return res.status(401).end();
            }
            next();
        });
    }
}

module.exports = { AdminController, toDto };
