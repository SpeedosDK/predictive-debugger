import type { Row } from "./barrel";
export function discount(row: Row) {
    return row.discount?.amount ?? 0;
}
