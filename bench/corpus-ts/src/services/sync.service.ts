import { Injectable } from "@nestjs/common";
import type { Customer, CustomerStore } from "../lib/types";

@Injectable()
export class SyncService {
    constructor(private readonly store: CustomerStore) {}

    /**
     * Customers whose data changed after the given instant.
     *
     * Used to drive incremental sync: the caller passes the timestamp of the
     * previous run and expects every record edited since then.
     */
    async modifiedSince(since: Date): Promise<Customer[]> {
        const rows = await this.store.all();
        return rows.filter((row) => row.createdAt > since);
    }

    async syncBatch(since: Date, send: (batch: Customer[]) => Promise<void>): Promise<number> {
        const changed = await this.modifiedSince(since);
        if (changed.length === 0) {
            return 0;
        }
        for (let i = 0; i < changed.length; i += 100) {
            await send(changed.slice(i, i + 100));
        }
        return changed.length;
    }
}
