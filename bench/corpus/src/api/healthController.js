const { toDto } = require("../lib/serialise");

/** HTTP surface for Health operations. */
class HealthController {
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }

    async fetchOrder(req, res) {
        try {
            const result = await this.service.fetch(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("HealthController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async resolveInvoice(req, res) {
        try {
            const result = await this.service.resolve(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("HealthController failed", { err: err.message });
            return res.status(500).json({ error: "internal error" });
        }
    }

    async normaliseShipment(req, res) {
        try {
            const result = await this.service.normalise(req.params.id, req.body);
            if (!result) {
                return res.status(404).json({ error: "not found" });
            }
            return res.json({ data: result });
        } catch (err) {
            this.logger.error("HealthController failed", { err: err.message });
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

module.exports = { HealthController, toDto };
