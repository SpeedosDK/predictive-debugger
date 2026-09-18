/** Tier pricing with a correctly bounded lookahead. */

function rateFor(tiers, quantity) {
    if (!Array.isArray(tiers) || tiers.length === 0) {
        return 0;
    }
    for (let i = 0; i < tiers.length - 1; i++) {
        const current = tiers[i];
        const next = tiers[i + 1];
        if (quantity >= current.minQuantity && quantity < next.minQuantity) {
            return current.rate;
        }
    }
    return tiers[tiers.length - 1].rate;
}

module.exports = { rateFor };
