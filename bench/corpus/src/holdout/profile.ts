export interface Address {
    city: string;
    country: string;
}

export interface Profile {
    name: string;
    address?: Address;
    theme?: "light" | "dark";
}

export function headline(profile: Profile): string {
    const city = profile.address?.city ?? "unknown";
    return `${profile.name.trim()} (${city})`;
}

export function theme(profile: Profile): "light" | "dark" {
    return profile.theme ?? "light";
}
