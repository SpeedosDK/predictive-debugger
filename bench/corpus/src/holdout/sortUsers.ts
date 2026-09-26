export interface User {
    name: string;
    createdAt: Date;
    score: number;
}

/** Newest accounts first. */
export function newestFirst(users: readonly User[]): User[] {
    return [...users].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Alphabetical by display name, case-insensitive. */
export function byName(users: readonly User[]): User[] {
    return [...users].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Highest score first; ties keep their existing order. */
export function byScore(users: readonly User[]): User[] {
    return [...users].sort((a, b) => b.score - a.score);
}
