/**
 * Best-effort notifications. Delivery is deliberately not awaited: callers
 * never wait on or inspect it, and each failure is logged, not thrown.
 */

function notifyAll(subscribers, message, send, log) {
    subscribers.forEach(async (subscriber) => {
        try {
            await send(subscriber.address, message);
        } catch (error) {
            log.warn("notification failed", { subscriber: subscriber.id, error: String(error) });
        }
    });
    return subscribers.length;
}

module.exports = { notifyAll };
