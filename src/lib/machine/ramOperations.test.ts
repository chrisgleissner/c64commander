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

/** Create a mock API backed by a shared 64 KiB memory buffer. */
const createMemoryBackedApi = () => {
    const memory = new Uint8Array(FULL_RAM_SIZE_BYTES);
    return {
        memory,
        api: {
            machinePause: vi.fn().mockResolvedValue(undefined),
            machineResume: vi.fn().mockResolvedValue(undefined),
            readMemory: vi.fn(async (addressHex: string, length: number) => {
                const address = parseInt(addressHex, 16);
                return memory.slice(address, address + length);
            }),
            writeMemoryBlock: vi.fn(async (addressHex: string, data: Uint8Array) => {
                const address = parseInt(addressHex, 16);
                memory.set(data, address);
            }),
        } as any,
    };
};

/** Fill a 64 KiB image with an address-as-data pattern (byte[i] = i & 0xFF). */
const createAddressPattern = () => {
    const pattern = new Uint8Array(FULL_RAM_SIZE_BYTES);
    for (let i = 0; i < FULL_RAM_SIZE_BYTES; i++) {
        pattern[i] = i & 0xFF;
    }
    return pattern;
};

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

    it('round-trips non-zero data through write → read with correct chunk assembly', async () => {
        const { api, memory } = createMemoryBackedApi();
        const pattern = createAddressPattern();

        await loadFullRamImage(api, pattern);
        expect(memory).toEqual(pattern);

        const readBack = await dumpFullRamImage(api);
        expect(readBack).toEqual(pattern);
        expect(readBack.length).toBe(FULL_RAM_SIZE_BYTES);
    });

    it('read assembles chunks at correct offsets', async () => {
        const { api, memory } = createMemoryBackedApi();

        // Write distinct byte values at each 4 KiB chunk boundary
        for (let chunk = 0; chunk < 16; chunk++) {
            const offset = chunk * 0x1000;
            memory.fill(chunk + 1, offset, offset + 0x1000);
        }

        const image = await dumpFullRamImage(api);

        for (let chunk = 0; chunk < 16; chunk++) {
            const offset = chunk * 0x1000;
            const expected = chunk + 1;
            expect(image[offset]).toBe(expected);
            expect(image[offset + 0x0FFF]).toBe(expected);
        }
    });

    it('rejects images that are not exactly 64 KiB', async () => {
        const { api } = createMemoryBackedApi();

        await expect(loadFullRamImage(api, new Uint8Array(100))).rejects.toThrow(
            /Invalid RAM image size/,
        );
        await expect(loadFullRamImage(api, new Uint8Array(FULL_RAM_SIZE_BYTES + 1))).rejects.toThrow(
            /Invalid RAM image size/,
        );
    });
});
