/** Header helpers, in an .mts module so the scan has one to find. */

export type HeaderBag = Record<string, string | string[] | undefined>;

export function firstValue(headers: HeaderBag, name: string): string | null {
    const raw = headers[name.toLowerCase()];
    if (raw === undefined) {
        return null;
    }
    return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export function hasHeader(headers: HeaderBag, name: string): boolean {
    return firstValue(headers, name) !== null;
}

export function contentType(headers: HeaderBag): string | null {
    const value = firstValue(headers, "content-type");
    return value === null ? null : value.split(";")[0].trim();
}
