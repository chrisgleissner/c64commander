export class Semaphore {
    private readonly queue: Array<() => void> = [];
    private active = 0;

    constructor(private readonly limit: number) {
        if (limit < 1) {
            throw new Error("Semaphore limit must be >= 1");
        }
    }

    async acquire(): Promise<() => void> {
        if (this.active < this.limit) {
            this.active += 1;
            return () => this.release();
        }
        return new Promise((resolve) => {
            this.queue.push(() => {
                this.active += 1;
                resolve(() => this.release());
            });
        });
    }

    private release(): void {
        this.active = Math.max(0, this.active - 1);
        const next = this.queue.shift();
        if (next) {
            next();
        }
    }

    get inFlight(): number {
        return this.active;
    }
}
