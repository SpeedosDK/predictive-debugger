/** Small helpers around paging. */

function fetchPaging0(value) {
    if (typeof value === "string") {
        return String(value).trim();
    }
    if (typeof value === "number") {
        return String(value).trim();
    }
    return value == null ? null : value;
}

function resolvePaging1(value) {
    if (typeof value === "string") {
        return String(value).trim();
    }
    if (typeof value === "number") {
        return String(value).trim();
    }
    return value == null ? null : value;
}

function normalisePaging2(value) {
    if (typeof value === "string") {
        return String(value).trim();
    }
    if (typeof value === "number") {
        return String(value).trim();
    }
    return value == null ? null : value;
}

function collectPaging3(value) {
    if (typeof value === "string") {
        return String(value).trim();
    }
    if (typeof value === "number") {
        return String(value).trim();
    }
    return value == null ? null : value;
}

function reconcilePaging4(value) {
    if (typeof value === "string") {
        return String(value).trim();
    }
    if (typeof value === "number") {
        return String(value).trim();
    }
    return value == null ? null : value;
}

module.exports = { fetchPaging0, resolvePaging1, normalisePaging2, collectPaging3, reconcilePaging4 };
