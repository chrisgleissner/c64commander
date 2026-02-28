/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

vi.mock('@/lib/machine/c64Liveness', () => ({
    checkC64Liveness: vi.fn(),
}));

vi.mock('@/lib/tracing/actionTrace', () => ({
    createActionContext: vi.fn(() => ({ correlationId: 'test' })),
    getActiveAction: vi.fn(() => null),
}));

vi.mock('@/lib/tracing/traceSession', () => ({
    recordDeviceGuard: vi.fn(),
}));

import { checkC64Liveness } from '@/lib/machine/c64Liveness';
import {
    FULL_RAM_SIZE_BYTES,
    dumpFullRamImage,
    loadFullRamImage,
    clearRamAndReboot,
} from '@/lib/machine/ramOperations';

type MockApi = {
    readMemory: ReturnType<typeof vi.fn>;
    writeMemoryBlock: ReturnType<typeof vi.fn>;
    machinePause: ReturnType<typeof vi.fn>;
    machineResume: ReturnType<typeof vi.fn>;
    machineReset: ReturnType<typeof vi.fn>;
    machineReboot: ReturnType<typeof vi.fn>;
    getBaseUrl: ReturnType<typeof vi.fn>;
    getDeviceHost: ReturnType<typeof vi.fn>;
};

const buildMockApi = (): MockApi => ({
    readMemory: vi.fn(async (_addr: string, length: number) => new Uint8Array(length)),
    writeMemoryBlock: vi.fn(async () => undefined),
    machinePause: vi.fn(async () => undefined),
    machineResume: vi.fn(async () => undefined),
    machineReset: vi.fn(async () => undefined),
    machineReboot: vi.fn(async () => undefined),
    getBaseUrl: vi.fn(() => 'http://localhost'),
    getDeviceHost: vi.fn(() => 'localhost'),
});

describe('ramOperations', () => {
    let api: MockApi;

    beforeEach(() => {
        vi.clearAllMocks();
        api = buildMockApi();
        vi.mocked(checkC64Liveness).mockResolvedValue({
            decision: 'healthy',
            jiffyAdvanced: true,
            rasterChanged: true,
        } as any);
    });

    describe('dumpFullRamImage', () => {
        it('pauses, reads all chunks, then resumes', async () => {
            const image = await dumpFullRamImage(api as any);

            expect(image).toBeInstanceOf(Uint8Array);
            expect(image.length).toBe(FULL_RAM_SIZE_BYTES);
            expect(api.machinePause).toHaveBeenCalledTimes(1);
            expect(api.machineResume).toHaveBeenCalledTimes(1);
            expect(api.readMemory).toHaveBeenCalled();
        });

        it('resumes on read failure and rethrows', async () => {
            api.readMemory.mockRejectedValue(new Error('read failed'));

            await expect(dumpFullRamImage(api as any)).rejects.toThrow('read failed');
            expect(api.machineResume).toHaveBeenCalled();
        });

        it('throws when liveness check reports wedged', async () => {
            vi.mocked(checkC64Liveness).mockResolvedValue({
                decision: 'wedged',
                jiffyAdvanced: false,
                rasterChanged: false,
            } as any);

            await expect(dumpFullRamImage(api as any)).rejects.toThrow('wedged');
        });

        it('throws when read returns unexpected chunk size', async () => {
            api.readMemory.mockResolvedValue(new Uint8Array(100));

            await expect(dumpFullRamImage(api as any)).rejects.toThrow('Unexpected RAM chunk length');
        });
    });

    describe('loadFullRamImage', () => {
        it('pauses, writes full image, then resumes', async () => {
            const image = new Uint8Array(FULL_RAM_SIZE_BYTES);
            await loadFullRamImage(api as any, image);

            expect(api.machinePause).toHaveBeenCalledTimes(1);
            expect(api.writeMemoryBlock).toHaveBeenCalled();
            expect(api.machineResume).toHaveBeenCalledTimes(1);
        });

        it('rejects invalid image size', async () => {
            const image = new Uint8Array(100);
            await expect(loadFullRamImage(api as any, image)).rejects.toThrow('Invalid RAM image size');
        });

        it('resumes on write failure', async () => {
            api.writeMemoryBlock.mockRejectedValue(new Error('write failed'));
            const image = new Uint8Array(FULL_RAM_SIZE_BYTES);

            await expect(loadFullRamImage(api as any, image)).rejects.toThrow('write failed');
            expect(api.machineResume).toHaveBeenCalled();
        });
    });

    describe('clearRamAndReboot', () => {
        it('pauses, writes zero blocks, then reboots', async () => {
            await clearRamAndReboot(api as any);

            expect(api.machinePause).toHaveBeenCalledTimes(1);
            expect(api.writeMemoryBlock).toHaveBeenCalled();
            expect(api.machineReboot).toHaveBeenCalled();
        });

        it('resumes on failure if not yet rebooted', async () => {
            api.writeMemoryBlock.mockRejectedValue(new Error('write failed'));

            await expect(clearRamAndReboot(api as any)).rejects.toThrow('write failed');
            expect(api.machineResume).toHaveBeenCalled();
        });

        it('reports both operation and resume failures', async () => {
            api.writeMemoryBlock.mockRejectedValue(new Error('write failed'));
            api.machineResume.mockRejectedValue(new Error('resume failed'));

            await expect(clearRamAndReboot(api as any)).rejects.toThrow('resume failed');
        });
    });
});
