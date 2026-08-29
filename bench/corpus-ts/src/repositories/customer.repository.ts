import type { Customer, Db, Page } from "../lib/types";

/** Data access for customers. Generic over the row shape the driver returns. */
export class CustomerRepository<TRow extends { id: string }> {
    constructor(private readonly db: Db) {}

    async byId(id: string): Promise<TRow | null> {
        const rows = await this.db.query<TRow>("SELECT * FROM customers WHERE id = $1", [id]);
        return rows[0] ?? null;
    }

    async page(offset: number, limit: number): Promise<Page<TRow>> {
        const rows = await this.db.query<TRow>(
            "SELECT * FROM customers ORDER BY created_at DESC OFFSET $1 LIMIT $2",
            [offset, limit]
        );
        const total = await this.db.count("customers");
        return { rows, total, offset, limit };
    }

    async search(term: string): Promise<TRow[]> {
        if (term.trim() === "") {
            return [];
        }
        return this.db.query<TRow>("SELECT * FROM customers WHERE name ILIKE $1", [`%${term}%`]);
    }

    async emailFor(customer: Customer): Promise<string | null> {
        const contact = customer.contact;
        if (!contact || !contact.email) {
            return null;
        }
        return contact.email.toLowerCase();
    }
}
