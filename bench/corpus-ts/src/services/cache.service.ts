import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { Clock } from "../lib/types";

interface CacheEntry {
    value: unknown;
    expiresAt: number;
}

/**
 * In-memory cache with a background sweep.
 *
 * Implements OnModuleDestroy so the container can release what this holds.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly sweep: NodeJS.Timeout;

    constructor(private readonly clock: Clock) {
        this.sweep = setInterval(() => this.evictExpired(), 60_000);
    }

    onModuleDestroy(): void {
        this.entries.clear();
    }

    get<T>(key: string): T | null {
        const entry = this.entries.get(key);
        if (!entry) {
            return null;
        }
        if (entry.expiresAt <= this.clock.now()) {
            this.entries.delete(key);
            return null;
        }
        return entry.value as T;
    }

    set(key: string, value: unknown, ttlMs: number): void {
        this.entries.set(key, { value, expiresAt: this.clock.now() + ttlMs });
    }

    delete(key: string): void {
        this.entries.delete(key);
    }

    private evictExpired(): void {
        const now = this.clock.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }

    size(): number {
        return this.entries.size;
    }
}
