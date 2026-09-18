/** Page lookup that validates its index before using it. */

function pageAt(pages, raw) {
    const requested = Number.parseInt(raw, 10);
    if (!Number.isInteger(requested) || requested < 0 || requested >= pages.length) {
        return null;
    }
    return pages[requested].rows;
}

module.exports = { pageAt };
