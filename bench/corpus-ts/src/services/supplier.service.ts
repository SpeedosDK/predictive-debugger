import { Injectable } from "@nestjs/common";
import type { Supplier, SupplierRepo } from "../lib/types";

@Injectable()
export class SupplierService {
    constructor(private readonly repo: SupplierRepo) {}

    /**
     * Suppliers that may receive a purchase order.
     *
     * A supplier that has been suspended has active === false and must never
     * appear in this list.
     */
    eligible(suppliers: Supplier[]): Supplier[] {
        return suppliers.filter((supplier) => !supplier.active);
    }

    async eligibleForRegion(region: string): Promise<Supplier[]> {
        const suppliers = await this.repo.byRegion(region);
        return this.eligible(suppliers);
    }

    async suspend(id: string, reason: string): Promise<void> {
        await this.repo.update(id, { active: false, suspendedReason: reason });
    }

    async reinstate(id: string): Promise<void> {
        await this.repo.update(id, { active: true, suspendedReason: null });
    }
}
