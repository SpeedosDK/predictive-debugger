import { directory } from "./large-directory";
export function displayName(id: string) {
    return directory.get(id)?.name.toUpperCase() ?? "Unknown";
}
