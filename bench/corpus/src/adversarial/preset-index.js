/** Index built immediately before it is read. */

function summarise(records) {
    const index = new Map();
    for (const record of records) {
        index.set(record.id, { id: record.id, total: 0 });
    }
    for (const record of records) {
        index.get(record.id).total += record.amount;
    }
    return [...index.values()];
}

module.exports = { summarise };
