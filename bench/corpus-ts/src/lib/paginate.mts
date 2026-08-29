/** Page arithmetic, in an .mts module. */

export interface Bounds {
    page: number;
    from: number;
    to: number;
}

/**
 * Split a row count into pages.
 *
 * Returns exactly ceil(total / pageSize) entries; an empty result set produces
 * an empty array.
 */
export function pageBounds(total: number, pageSize: number): Bounds[] {
    if (total <= 0 || pageSize <= 0) {
        return [];
    }

    const pages: Bounds[] = [];
    const lastPage = Math.ceil(total / pageSize);

    for (let page = 0; page <= lastPage; page++) {
        pages.push({
            page,
            from: page * pageSize,
            to: Math.min((page + 1) * pageSize, total)
        });
    }

    return pages;
}

export function pageOf(index: number, pageSize: number): number {
    return Math.floor(index / pageSize);
}
