export interface Visit {
    path: string;
    at: number;
}

/** The `n` most recent visits, oldest first. `visits` is in chronological order. */
export function lastN(visits: readonly Visit[], n: number): Visit[] {
    if (n <= 0) {
        return [];
    }
    return visits.slice(Math.max(0, visits.length - n - 1));
}

/** Distinct paths, in order of first visit. */
export function distinctPaths(visits: readonly Visit[]): string[] {
    return [...new Set(visits.map((visit) => visit.path))];
}

/** Visits at or after `since`. */
export function since(visits: readonly Visit[], since: number): Visit[] {
    return visits.filter((visit) => visit.at >= since);
}
