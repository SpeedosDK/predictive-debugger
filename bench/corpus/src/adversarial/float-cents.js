/** Settlement check over floating-point currency amounts. */

function isSettled(invoice) {
    const charged = invoice.lines.reduce((sum, line) => sum + line.amount, 0);
    const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    return charged === paid;
}

module.exports = { isSettled };
