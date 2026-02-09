/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  FULL_RAM_SIZE_BYTES,
  clearRamAndReboot,
  dumpFullRamImage,
  loadFullRamImage,
} from '@/lib/machine/ramOperations';

const { livenessMock, traceSessionMock, loggingMock } = vi.hoisted(() => ({
  livenessMock: {
    checkC64Liveness: vi.fn(),
  },
  traceSessionMock: {
    recordDeviceGuard: vi.fn(),
    getActiveAction: vi.fn(),
    createActionContext: vi.fn(() => ({ id: 'ctx' })),
  },
  loggingMock: {
    addErrorLog: vi.fn(),
  },
}));

vi.mock('@/lib/machine/c64Liveness', () => livenessMock);
vi.mock('@/lib/tracing/traceSession', () => traceSessionMock);
vi.mock('@/lib/tracing/actionTrace', () => ({
  getActiveAction: traceSessionMock.getActiveAction,
  createActionContext: traceSessionMock.createActionContext,
}));
vi.mock('@/lib/logging', () => loggingMock);

const buildApi = () => {
  let jiffy = 0;
  let raster = 0;
  return {
    machinePause: vi.fn().mockResolvedValue({ errors: [] }),
    machineResume: vi.fn().mockResolvedValue({ errors: [] }),
    machineReboot: vi.fn().mockResolvedValue({ errors: [] }),
    machineReset: vi.fn().mockResolvedValue({ errors: [] }),
    readMemory: vi.fn(async (address: string, length: number) => {
      if (address === '00A2') {
        const value = jiffy;
        jiffy += 1;
        return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
      }
      if (address === 'D012') {
        raster = (raster + 1) & 0xff;
        return new Uint8Array([raster]);
      }
      return new Uint8Array(length).fill(0x2A);
    }),
    writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
  };
};

describe('ramOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    livenessMock.checkC64Liveness.mockResolvedValue({ decision: 'ok' });
  });

  it('dumps full RAM while paused and resumes afterwards', async () => {
    const api = buildApi();

    const image = await dumpFullRamImage(api as any);

    expect(image.length).toBe(FULL_RAM_SIZE_BYTES);
    expect(api.machinePause).toHaveBeenCalledTimes(1);
    expect(api.machineResume).toHaveBeenCalledTimes(1);
    expect(api.readMemory).toHaveBeenCalled();
    expect(api.readMemory).toHaveBeenCalledWith('0000', 4096);
    expect(api.readMemory).toHaveBeenLastCalledWith('F000', 4096);
  });

  it('loads full RAM while paused and resumes afterwards', async () => {
    const api = buildApi();
    const image = new Uint8Array(FULL_RAM_SIZE_BYTES);
    image.fill(0x11);

    await loadFullRamImage(api as any, image);

    expect(api.machinePause).toHaveBeenCalledTimes(1);
    expect(api.machineResume).toHaveBeenCalledTimes(1);
    expect(api.writeMemoryBlock).toHaveBeenCalledWith('0000', expect.any(Uint8Array));
    expect(api.writeMemoryBlock).toHaveBeenLastCalledWith('0000', expect.any(Uint8Array));
  });

  it('reads RAM in monotonic 4KB chunks', async () => {
    const api = buildApi();

    await dumpFullRamImage(api as any);

    const chunkReads = api.readMemory.mock.calls
      .filter(([, length]: [string, number]) => length === 4096)
      .map(([address]) => address);

    expect(chunkReads.length).toBe(16);
    expect(chunkReads[0]).toBe('0000');
    expect(chunkReads[chunkReads.length - 1]).toBe('F000');
    const addresses = chunkReads.map((value) => parseInt(value, 16));
    addresses.forEach((value, index) => {
      expect(value).toBe(index * 0x1000);
    });
  });

  it('writes RAM in a single 64KB chunk', async () => {
    const api = buildApi();
    const image = new Uint8Array(FULL_RAM_SIZE_BYTES);

    await loadFullRamImage(api as any, image);

    const chunkWrites = api.writeMemoryBlock.mock.calls
      .map(([address]: [string]) => address);

    expect(chunkWrites.length).toBe(1);
    expect(chunkWrites[0]).toBe('0000');
  });

  it('rejects RAM images with invalid size', async () => {
    const api = buildApi();
    await expect(loadFullRamImage(api as any, new Uint8Array(1234))).rejects.toThrow(
      'Invalid RAM image size',
    );
  });

  it('clears RAM excluding IO range and reboots', async () => {
    const api = buildApi();

    await clearRamAndReboot(api as any);

    const addresses = api.writeMemoryBlock.mock.calls.map((call: [string]) => call[0]);
    expect(addresses).toContain('0000');
    expect(addresses).toContain('E000');
    expect(addresses).not.toContain('D000');
    expect(api.machineReboot).toHaveBeenCalledTimes(1);
  });

  it('retries failed operations', async () => {
    const api = buildApi();
    let failed = false;
    const originalRead = api.readMemory.getMockImplementation();
    api.readMemory.mockImplementation(async (address: string, length: number) => {
      if (address === '0000' && !failed) {
        failed = true;
        throw new Error('temporary read error');
      }
      return originalRead ? originalRead(address, length) : new Uint8Array(length);
    });

    const image = await dumpFullRamImage(api as any);

    expect(failed).toBe(true);
    expect(image.length).toBe(FULL_RAM_SIZE_BYTES);
    expect(api.readMemory).toHaveBeenCalled();
  });

  it('aborts dump if C64 is wedged', async () => {
    livenessMock.checkC64Liveness.mockResolvedValue({ decision: 'wedged' });
    const api = buildApi();
    await expect(dumpFullRamImage(api as any)).rejects.toThrow('aborted: C64 appears wedged');
  });

  it('reports liveness check failure but proceeds if not explicitly wedged/unknown', async () => {
    livenessMock.checkC64Liveness.mockRejectedValue(new Error('Liveness check failed'));
    const api = buildApi();
    // It should throw the error because recoverFromLivenessFailure logic rethrows
    await expect(dumpFullRamImage(api as any)).rejects.toThrow('Liveness check failed');
  });

  it('fails after max retries', async () => {
    const api = buildApi();
    const error = new Error('Persistent failure');
    api.readMemory.mockRejectedValue(error);

    // Override delay to speed up test? Not easy without fake timers or mock.
    // However, with only 2 retries and 120ms wait, it's 240ms. Acceptable.

    await expect(dumpFullRamImage(api as any)).rejects.toThrow(/Save RAM failed: Read RAM chunk at \$0000 failed after 2 attempt/);
    expect(loggingMock.addErrorLog).toHaveBeenCalledTimes(1); // 1 retry recorded for 2 attempts
  });
});
