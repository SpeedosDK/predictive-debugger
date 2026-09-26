export interface QuotaStore {
    used(account: string): Promise<number>;
    setUsed(account: string, value: number): Promise<void>;
}

/** Monthly upload quota. Calls for one account are applied one at a time, in arrival order. */
export class Quota {
    private readonly queues = new Map<string, Promise<unknown>>();

    constructor(private readonly store: QuotaStore, private readonly limit: number) {}

    consume(account: string, bytes: number): Promise<boolean> {
        const previous = this.queues.get(account) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(async () => {
            const used = await this.store.used(account);
            if (used + bytes > this.limit) {
                return false;
            }
            await this.store.setUsed(account, used + bytes);
            return true;
        });
        this.queues.set(account, next);
        void next.finally(() => {
            if (this.queues.get(account) === next) {
                this.queues.delete(account);
            }
        }).catch(() => undefined);
        return next;
    }
}
