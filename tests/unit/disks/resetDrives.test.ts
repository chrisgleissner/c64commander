import { describe, expect, it, vi } from 'vitest';
import {
  listConnectedDrives,
  resetConnectedDrives,
  resetDiskDevices,
  resetPrinterDevice,
} from '@/lib/disks/resetDrives';

describe('resetDrives', () => {
  const drivesPayload = {
    drives: [
      { b: { enabled: true, bus_id: 9, type: '1541' } },
      { a: { enabled: true, bus_id: 8, type: '1541' } },
      { 'IEC Drive': { enabled: true, bus_id: 11, type: 'DOS emulation' } },
      { 'Printer Emulation': { enabled: true, bus_id: 4 } },
    ],
  };

  it('lists connected physical drives in stable order', () => {
    const drives = listConnectedDrives(drivesPayload);
    expect(drives).toEqual(['a', 'b']);
  });

  it('resets disk devices only (A, B, Soft IEC)', async () => {
    const resetDrive = vi.fn().mockResolvedValue(undefined);

    await expect(resetDiskDevices({ resetDrive }, drivesPayload)).resolves.toMatchObject({
      endpointKeys: ['a', 'b', 'softiec'],
    });

    expect(resetDrive).toHaveBeenCalledTimes(3);
    expect(resetDrive).toHaveBeenNthCalledWith(1, 'a');
    expect(resetDrive).toHaveBeenNthCalledWith(2, 'b');
    expect(resetDrive).toHaveBeenNthCalledWith(3, 'softiec');
  });

  it('keeps legacy wrapper behavior for physical drives', async () => {
    const resetDrive = vi.fn().mockResolvedValue(undefined);

    await expect(resetConnectedDrives({ resetDrive }, drivesPayload)).resolves.toEqual({ drives: ['a', 'b'] });
  });

  it('resets printer only', async () => {
    const resetDrive = vi.fn().mockResolvedValue(undefined);

    await expect(resetPrinterDevice({ resetDrive }, drivesPayload)).resolves.toMatchObject({
      endpointKey: 'printer',
    });

    expect(resetDrive).toHaveBeenCalledTimes(1);
    expect(resetDrive).toHaveBeenCalledWith('printer');
  });

  it('continues after an individual disk reset failure and reports context', async () => {
    const resetDrive = vi.fn()
      .mockRejectedValueOnce(new Error('A failed'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      resetDiskDevices({ resetDrive }, drivesPayload),
    ).rejects.toThrow('Drive A: A failed');

    expect(resetDrive).toHaveBeenCalledTimes(3);
  });

  it('fails when no resettable disk devices are present', async () => {
    const resetDrive = vi.fn();
    await expect(
      resetDiskDevices({ resetDrive }, { drives: [{ 'Printer Emulation': { enabled: true, bus_id: 4 } }] }),
    ).rejects.toThrow('No resettable disk devices found.');
    expect(resetDrive).not.toHaveBeenCalled();
  });

  it('fails when printer device is not present', async () => {
    const resetDrive = vi.fn();
    await expect(
      resetPrinterDevice({ resetDrive }, { drives: [{ a: { enabled: true, bus_id: 8, type: '1541' } }] }),
    ).rejects.toThrow('No printer device found.');
    expect(resetDrive).not.toHaveBeenCalled();
  });
});
