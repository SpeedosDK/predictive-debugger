export const dates = { normalize(value: Date | string) { return value instanceof Date ? value : new Date(value); } };
