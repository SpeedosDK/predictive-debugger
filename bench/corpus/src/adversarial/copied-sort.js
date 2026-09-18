/** Ranking that sorts a copy, so the caller's array keeps its order. */

function topSuppliers(suppliers, limit) {
    return [...suppliers]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);
}

module.exports = { topSuppliers };
