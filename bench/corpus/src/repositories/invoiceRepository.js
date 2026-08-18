/** Data access for Invoice. */
class InvoiceRepository {
    constructor(db) {
        this.db = db;
    }

    async findOrders(id) {
        const rows = await this.db.query(
            "SELECT * FROM orders WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findInvoices(id) {
        const rows = await this.db.query(
            "SELECT * FROM invoices WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findShipments(id) {
        const rows = await this.db.query(
            "SELECT * FROM shipments WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findCustomers(id) {
        const rows = await this.db.query(
            "SELECT * FROM customers WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findPayments(id) {
        const rows = await this.db.query(
            "SELECT * FROM payments WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findRefunds(id) {
        const rows = await this.db.query(
            "SELECT * FROM refunds WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findCoupons(id) {
        const rows = await this.db.query(
            "SELECT * FROM coupons WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findAddresss(id) {
        const rows = await this.db.query(
            "SELECT * FROM addresss WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findOrders(id) {
        const rows = await this.db.query(
            "SELECT * FROM orders WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findInvoices(id) {
        const rows = await this.db.query(
            "SELECT * FROM invoices WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findShipments(id) {
        const rows = await this.db.query(
            "SELECT * FROM shipments WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async findCustomers(id) {
        const rows = await this.db.query(
            "SELECT * FROM customers WHERE owner_id = $1 ORDER BY created_at DESC",
            [id]
        );
        return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    }

    async loadBatch(id) {
        const rows = await this.db.query("SELECT * FROM batches WHERE id = $1", [id]);
        return rows;
    }
}

module.exports = { InvoiceRepository };
