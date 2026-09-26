/**
 * Keeps a connection's health flag current. A failed ping must mark the
 * connection unhealthy so the pool stops handing it out.
 */

class Heartbeat {
    constructor(client, intervalMs = 5000) {
        this.client = client;
        this.intervalMs = intervalMs;
        this.healthy = true;
        this.timer = null;
    }

    start() {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(async () => {
            await this.client.ping();
            this.healthy = true;
        }, this.intervalMs);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    markUnhealthy() {
        this.healthy = false;
    }
}

module.exports = { Heartbeat };
