import { describe, expect, it, vi } from 'vitest';
import {
  FULL_RAM_SIZE_BYTES,
  clearRamAndReboot,
  dumpFullRamImage,
  loadFullRamImage,
} from '@/lib/machine/ramOperations';

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
  it('dumps full RAM while paused and resumes afterwards', async () => {
    const api = buildApi();

    const image = await dumpFullRamImage(api as any);

    expect(image.length).toBe(FULL_RAM_SIZE_BYTES);
    expect(api.machinePause).toHaveBeenCalledTimes(1);
    expect(api.machineResume).toHaveBeenCalledTimes(1);
    expect(api.readMemory).toHaveBeenCalled();
    expect(api.readMemory).toHaveBeenCalledWith('0000', 2048);
    expect(api.readMemory).toHaveBeenLastCalledWith('F800', 2048);
  });

  it('loads full RAM while paused and resumes afterwards', async () => {
    const api = buildApi();
    const image = new Uint8Array(FULL_RAM_SIZE_BYTES);
    image.fill(0x11);

    await loadFullRamImage(api as any, image);

    expect(api.machinePause).toHaveBeenCalledTimes(1);
    expect(api.machineResume).toHaveBeenCalledTimes(1);
    expect(api.writeMemoryBlock).toHaveBeenCalledWith('0000', expect.any(Uint8Array));
    expect(api.writeMemoryBlock).toHaveBeenLastCalledWith('F800', expect.any(Uint8Array));
  });

  it('reads RAM in monotonic 2KB chunks', async () => {
    const api = buildApi();

    await dumpFullRamImage(api as any);

    const chunkReads = api.readMemory.mock.calls
      .filter(([, length]: [string, number]) => length === 2048)
      .map(([address]) => address);

    expect(chunkReads.length).toBe(32);
    expect(chunkReads[0]).toBe('0000');
    expect(chunkReads[chunkReads.length - 1]).toBe('F800');
    const addresses = chunkReads.map((value) => parseInt(value, 16));
    addresses.forEach((value, index) => {
      expect(value).toBe(index * 0x800);
    });
  });

  it('writes RAM in monotonic 2KB chunks', async () => {
    const api = buildApi();
    const image = new Uint8Array(FULL_RAM_SIZE_BYTES);

    await loadFullRamImage(api as any, image);

    const chunkWrites = api.writeMemoryBlock.mock.calls
      .map(([address]: [string]) => address);

    expect(chunkWrites.length).toBe(32);
    expect(chunkWrites[0]).toBe('0000');
    expect(chunkWrites[chunkWrites.length - 1]).toBe('F800');
    const addresses = chunkWrites.map((value) => parseInt(value, 16));
    addresses.forEach((value, index) => {
      expect(value).toBe(index * 0x800);
    });
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
});
