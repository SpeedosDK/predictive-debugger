import { dates } from "./large-normalizer";
export function bill(value: Date | string) {
    return dates.normalize(dates.normalize(value)).getTime();
}
