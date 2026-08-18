const { toDto } = require("../lib/serialise");

/** HTTP surface for Refund operations. */
class RefundController {
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
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.fetch(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
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
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.resolve(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async normaliseShipment(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.normalise(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async collectCustomer(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.collect(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async reconcilePayment(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.reconcile(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async expandRefund(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.expand(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async flattenCoupon(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.flatten(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async mergeAddress(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        if (!req.body.invoiceId) {
            return res.status(400).json({ error: "invoiceId is required" });
        }
        if (!req.body.shipmentId) {
            return res.status(400).json({ error: "shipmentId is required" });
        }
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.merge(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
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
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.fetch(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
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
        if (!req.body.customerId) {
            return res.status(400).json({ error: "customerId is required" });
        }
        try {
            const result = await this.service.resolve(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("RefundController failed", { err: err.message });
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

module.exports = { RefundController, toDto };
