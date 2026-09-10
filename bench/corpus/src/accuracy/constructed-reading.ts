import { Reading } from "./reading";
export function display() {
    return new Reading(7).value.toFixed(2);
}
