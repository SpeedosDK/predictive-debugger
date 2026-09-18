/** Totals kept in integer cents, so equality comparisons are exact. */

function isSettled(invoice) {
    const charged = invoice.lines.reduce((sum, line) => sum + line.amountCents, 0);
    const paid = invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    return charged === paid;
}

module.exports = { isSettled };
