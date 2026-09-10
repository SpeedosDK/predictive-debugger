import { Reading } from "./reading";
export function display() {
    return Number(new Reading(7).value).toFixed(2);
}
