import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/machine/c64Liveness', () => ({
    checkC64Liveness: vi.fn().mockResolvedValue({
        decision: 'healthy',
        jiffyStart: 0,
        jiffyEnd: 1,
        jiffyAdvanced: true,
        rasterStart: 0,
        rasterEnd: 1,
        rasterChanged: true,
    }),
}));

vi.mock('@/lib/tracing/actionTrace', () => ({
    createActionContext: vi.fn(() => ({ id: 'test-action' })),
    getActiveAction: vi.fn(() => null),
}));

vi.mock('@/lib/tracing/traceSession', () => ({
    recordDeviceGuard: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
}));

import { dumpFullRamImage, loadFullRamImage, FULL_RAM_SIZE_BYTES } from './ramOperations';

describe('ramOperations', () => {
    it('reads full RAM in 4KB chunks while paused', async () => {
        const api = {
            machinePause: vi.fn().mockResolvedValue(undefined),
            machineResume: vi.fn().mockResolvedValue(undefined),
            readMemory: vi.fn(async (_address: string, length: number) => new Uint8Array(length)),
        } as any;

        const image = await dumpFullRamImage(api);

        expect(api.machinePause).toHaveBeenCalledTimes(1);
        expect(api.machineResume).toHaveBeenCalledTimes(1);
        expect(api.readMemory).toHaveBeenCalledTimes(16);
        expect(image.length).toBe(FULL_RAM_SIZE_BYTES);
        expect(api.readMemory).toHaveBeenNthCalledWith(1, '0000', 0x1000);
        expect(api.readMemory).toHaveBeenNthCalledWith(16, 'F000', 0x1000);
    });

    it('writes full RAM image in a single request', async () => {
        const api = {
            machinePause: vi.fn().mockResolvedValue(undefined),
            machineResume: vi.fn().mockResolvedValue(undefined),
            writeMemoryBlock: vi.fn().mockResolvedValue(undefined),
        } as any;

        await loadFullRamImage(api, new Uint8Array(FULL_RAM_SIZE_BYTES));

        expect(api.machinePause).toHaveBeenCalledTimes(1);
        expect(api.machineResume).toHaveBeenCalledTimes(1);
        expect(api.writeMemoryBlock).toHaveBeenCalledTimes(1);
        expect(api.writeMemoryBlock).toHaveBeenCalledWith('0000', expect.any(Uint8Array));
        expect(api.writeMemoryBlock.mock.calls[0][1]).toHaveLength(FULL_RAM_SIZE_BYTES);
    });
});
