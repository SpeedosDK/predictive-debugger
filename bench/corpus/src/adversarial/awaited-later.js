/** Work started eagerly and awaited inside the try that handles its failure. */

class ReportJob {
    constructor(client, logger) {
        this.client = client;
        this.logger = logger;
    }

    async run(reportId) {
        const pending = this.client.render(reportId);
        try {
            const rendered = await pending;
            return { reportId, bytes: rendered.length };
        } catch (error) {
            this.logger.error("render failed", { reportId, message: error.message });
            return { reportId, bytes: 0 };
        }
    }
}

module.exports = { ReportJob };
