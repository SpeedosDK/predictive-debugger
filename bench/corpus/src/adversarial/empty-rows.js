/** Report header derived from the first row, behind an emptiness check. */

function headerFor(rows) {
    if (rows.length === 0) {
        return { columns: [], generatedAt: null };
    }
    const columns = Object.keys(rows[0]);
    return { columns, generatedAt: rows[0].capturedAt };
}

module.exports = { headerFor };
