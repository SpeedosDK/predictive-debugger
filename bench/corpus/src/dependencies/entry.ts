import { value } from "./barrel";
import type { Shape } from "./types";
export const result: Shape = { value };
export function lazy() { return import("./lazy"); }
export function load(name: string) { return import("./" + name); }
