export interface Source {
    fetch(): Promise<string[]>;
}

/** Polls a source and keeps the latest successful result. Failures keep the previous result. */
export class Poller {
    private timer: ReturnType<typeof setInterval> | undefined;
    private latest: string[] = [];
    private failures = 0;

    constructor(private readonly source: Source, private readonly intervalMs: number) {}

    start(): void {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            this.source.fetch().then(
                (items) => { this.latest = items; this.failures = 0; },
                () => { this.failures += 1; }
            );
        }, this.intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    snapshot(): { items: string[]; failures: number } {
        return { items: [...this.latest], failures: this.failures };
    }
}
