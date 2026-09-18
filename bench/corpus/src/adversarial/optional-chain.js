/** Address formatting across a fully optional chain. */

function shippingCity(order) {
    const city = order?.customer?.addresses?.shipping?.city;
    return typeof city === "string" && city.length > 0 ? city : "unknown";
}

module.exports = { shippingCity };
