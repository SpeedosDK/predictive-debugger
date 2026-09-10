import { couponFor } from "./coupon.barrel";
export function discount(id: string) {
    return couponFor(id)?.amount ?? 0;
}
