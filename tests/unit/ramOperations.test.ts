import { describe, expect, it, vi } from 'vitest';
import {
  FULL_RAM_SIZE_BYTES,
  clearRamAndReboot,
  dumpFullRamImage,
  loadFullRamImage,
} from '@/lib/machine/ramOperations';

const buildApi = () => ({
  machinePause: vi.fn().mockResolvedValue({ errors: [] }),
  machineResume: vi.fn().mockResolvedValue({ errors: [] }),
  machineReboot: vi.fn().mockResolvedValue({ errors: [] }),
  readMemory: vi.fn(async (_address: string, length: number) => new Uint8Array(length).fill(0x2A)),
  writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
});

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
    api.readMemory.mockImplementationOnce(async () => {
      failed = true;
      throw new Error('temporary read error');
    });

    const image = await dumpFullRamImage(api as any);

    expect(failed).toBe(true);
    expect(image.length).toBe(FULL_RAM_SIZE_BYTES);
    expect(api.readMemory).toHaveBeenCalledTimes(33);
  });
});
