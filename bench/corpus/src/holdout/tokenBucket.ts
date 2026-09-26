export interface BucketState {
    tokens: number;
    updatedAt: number;
}

export interface BucketStore {
    get(key: string): Promise<BucketState | undefined>;
    set(key: string, state: BucketState): Promise<void>;
}

/**
 * Per-client rate limiter used by the API gateway for every incoming request.
 * A client may make at most `capacity` requests per refill window.
 */
export class TokenBucket {
    constructor(
        private readonly store: BucketStore,
        private readonly capacity: number,
        private readonly refillPerSecond: number
    ) {}

    async take(clientId: string, now = Date.now()): Promise<boolean> {
        const state = (await this.store.get(clientId)) ?? { tokens: this.capacity, updatedAt: now };
        const elapsed = Math.max(0, now - state.updatedAt) / 1000;
        const tokens = Math.min(this.capacity, state.tokens + elapsed * this.refillPerSecond);
        if (tokens < 1) {
            await this.store.set(clientId, { tokens, updatedAt: now });
            return false;
        }
        await this.store.set(clientId, { tokens: tokens - 1, updatedAt: now });
        return true;
    }

    async remaining(clientId: string, now = Date.now()): Promise<number> {
        const state = await this.store.get(clientId);
        if (!state) {
            return this.capacity;
        }
        const elapsed = Math.max(0, now - state.updatedAt) / 1000;
        return Math.floor(Math.min(this.capacity, state.tokens + elapsed * this.refillPerSecond));
    }
}
