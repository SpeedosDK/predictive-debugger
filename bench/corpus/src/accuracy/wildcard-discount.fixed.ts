import type { Row } from "./wildcard.barrel";
export function discount(row: Row) {
    return row.discount?.amount ?? 0;
}
