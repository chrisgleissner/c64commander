import { describe, expect, it } from 'vitest';
import { checkC64Liveness } from '@/lib/machine/c64Liveness';

type MockApi = {
    readMemory: (address: string, length: number) => Promise<Uint8Array>;
};

const buildApi = (responses: Record<string, Uint8Array[]>) => {
    const counters = new Map<string, number>();
    return {
        readMemory: async (address: string, length: number) => {
            const key = `${address}:${length}`;
            const index = counters.get(key) ?? 0;
            counters.set(key, index + 1);
            const values = responses[key] ?? [];
            const value = values[Math.min(index, values.length - 1)] ?? new Uint8Array(length);
            return value;
        },
    } satisfies MockApi;
};

describe('checkC64Liveness', () => {
    it('reports healthy when jiffy advances', async () => {
        const api = buildApi({
            '00A2:3': [new Uint8Array([1, 0, 0]), new Uint8Array([2, 0, 0])],
            'D012:1': [new Uint8Array([10]), new Uint8Array([11])],
        });

        const result = await checkC64Liveness(api as any, { jiffyWaitMs: 0, rasterAttempts: 1, rasterDelayMs: 0 });

        expect(result.decision).toBe('healthy');
        expect(result.jiffyAdvanced).toBe(true);
    });

    it('reports irq-stalled when jiffy stalls but raster changes', async () => {
        const api = buildApi({
            '00A2:3': [new Uint8Array([1, 0, 0]), new Uint8Array([1, 0, 0])],
            'D012:1': [new Uint8Array([10]), new Uint8Array([12])],
        });

        const result = await checkC64Liveness(api as any, { jiffyWaitMs: 0, rasterAttempts: 2, rasterDelayMs: 0 });

        expect(result.decision).toBe('irq-stalled');
        expect(result.rasterChanged).toBe(true);
    });

    it('reports wedged when jiffy and raster stall', async () => {
        const api = buildApi({
            '00A2:3': [new Uint8Array([1, 0, 0]), new Uint8Array([1, 0, 0])],
            'D012:1': [new Uint8Array([10]), new Uint8Array([10])],
        });

        const result = await checkC64Liveness(api as any, { jiffyWaitMs: 0, rasterAttempts: 1, rasterDelayMs: 0 });

        expect(result.decision).toBe('wedged');
        expect(result.rasterChanged).toBe(false);
    });
});
