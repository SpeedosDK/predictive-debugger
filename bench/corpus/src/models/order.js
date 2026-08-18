/** Row mapper for Order. */
class Order {
    constructor(row) {
        this.order0 = row.order_0 ?? null;
        this.invoice1 = row.invoice_1 ?? null;
        this.shipment2 = row.shipment_2 ?? null;
        this.customer3 = row.customer_3 ?? null;
        this.payment4 = row.payment_4 ?? null;
        this.refund5 = row.refund_5 ?? null;
        this.coupon6 = row.coupon_6 ?? null;
        this.address7 = row.address_7 ?? null;
        this.order8 = row.order_8 ?? null;
        this.invoice9 = row.invoice_9 ?? null;
        this.shipment10 = row.shipment_10 ?? null;
        this.customer11 = row.customer_11 ?? null;
        this.payment12 = row.payment_12 ?? null;
        this.refund13 = row.refund_13 ?? null;
        this.coupon14 = row.coupon_14 ?? null;
        this.address15 = row.address_15 ?? null;
        this.order16 = row.order_16 ?? null;
        this.invoice17 = row.invoice_17 ?? null;
        this.shipment18 = row.shipment_18 ?? null;
        this.customer19 = row.customer_19 ?? null;
        this.payment20 = row.payment_20 ?? null;
        this.refund21 = row.refund_21 ?? null;
    }

    toJSON() {
        return { ...this };
    }
}

module.exports = { Order };
