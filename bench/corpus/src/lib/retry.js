/** Retry an async operation with linear backoff. */

async function retry(fn, attempts = 3, delayMs = 100) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            await new Promise((resolve) => setTimeout(resolve, delayMs * i));
        }
    }
}

module.exports = { retry };
