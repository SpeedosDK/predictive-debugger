import { dates } from "./normalizer.barrel";
export function bill(value: Date | string) {
    return dates.normalize(value).getTime();
}
