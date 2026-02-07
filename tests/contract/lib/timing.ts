export type Percentiles = {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
};

export type LatencySummary = Percentiles & {
    samples: number;
    min: number;
    max: number;
    mean: number;
};

export class LatencyTracker {
    private readonly samples: number[] = [];

    record(ms: number): void {
        if (!Number.isFinite(ms)) {
            return;
        }
        this.samples.push(ms);
    }

    summary(): LatencySummary | null {
        if (this.samples.length === 0) {
            return null;
        }
        const sorted = [...this.samples].sort((a, b) => a - b);
        const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
        return {
            samples: sorted.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean,
            ...percentiles(sorted)
        };
    }
}

export function percentiles(sortedSamples: number[]): Percentiles {
    const p = (q: number) => {
        if (sortedSamples.length === 0) {
            return 0;
        }
        const idx = Math.min(sortedSamples.length - 1, Math.max(0, Math.ceil(q * sortedSamples.length) - 1));
        return sortedSamples[idx];
    };
    return {
        p50: p(0.5),
        p90: p(0.9),
        p95: p(0.95),
        p99: p(0.99)
    };
}

export function deriveCooldown(summary: LatencySummary): { minDelayMs: number; recommendedDelayMs: number; maxDelayMs: number } {
    return {
        minDelayMs: Math.ceil(summary.p50),
        recommendedDelayMs: Math.ceil(summary.p90),
        maxDelayMs: Math.ceil(summary.p99)
    };
}

export function delay(ms: number): Promise<void> {
    if (ms <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
}
