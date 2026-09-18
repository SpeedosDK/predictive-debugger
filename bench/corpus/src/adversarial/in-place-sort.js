/** Ranking that sorts the array it was handed. */

function topSuppliers(suppliers, limit) {
    return suppliers
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);
}

module.exports = { topSuppliers };
