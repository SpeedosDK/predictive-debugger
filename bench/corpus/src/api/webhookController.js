const { toDto } = require("../lib/serialise");

/** HTTP surface for Webhook operations. */
class WebhookController {
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }

    async fetchInvoice(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        try {
            const result = await this.service.fetch(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("WebhookController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async resolveShipment(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        try {
            const result = await this.service.resolve(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("WebhookController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async normaliseCustomer(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        try {
            const result = await this.service.normalise(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("WebhookController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async collectPayment(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        try {
            const result = await this.service.collect(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("WebhookController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async reconcileRefund(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        try {
            const result = await this.service.reconcile(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("WebhookController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async expandCoupon(req, res) {
        if (!req.body.orderId) {
            return res.status(400).json({ error: "orderId is required" });
        }
        try {
            const result = await this.service.expand(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("WebhookController failed", { err: err.message });
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

module.exports = { WebhookController, toDto };
