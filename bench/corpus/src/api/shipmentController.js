const { toDto } = require("../lib/serialise");

/** HTTP surface for Shipment operations. */
class ShipmentController {
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }

    async fetchShipment(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async resolveCustomer(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async normalisePayment(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async collectRefund(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async reconcileCoupon(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async expandAddress(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
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
            this.logger.error("ShipmentController failed", { err: err.message });
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async fetchShipment(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async resolveCustomer(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async normalisePayment(req, res) {
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
            this.logger.error("ShipmentController failed", { err: err.message });
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

module.exports = { ShipmentController, toDto };
