/**
 * Forwards chat messages from a socket-like emitter to a handler.
 * After detach() the bridge must stop forwarding: the handler may already be disposed.
 */

class EventBridge {
    constructor(handler) {
        this.handler = handler;
        this.emitter = null;
        this.forwarded = 0;
    }

    onMessage(message) {
        this.forwarded += 1;
        this.handler.handle(message);
    }

    attach(emitter) {
        this.emitter = emitter;
        emitter.on("message", this.onMessage.bind(this));
    }

    detach() {
        if (!this.emitter) {
            return;
        }
        this.emitter.off("message", this.onMessage.bind(this));
        this.emitter = null;
    }

    stats() {
        return { attached: this.emitter !== null, forwarded: this.forwarded };
    }
}

module.exports = { EventBridge };
