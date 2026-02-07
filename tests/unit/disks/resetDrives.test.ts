import { describe, expect, it, vi } from 'vitest';
import { listConnectedDrives, resetConnectedDrives } from '@/lib/disks/resetDrives';

describe('resetDrives', () => {
  it('lists connected drives in stable order', () => {
    const drives = listConnectedDrives({
      drives: [{ b: { enabled: true, bus_id: 9, type: '1541' } }, { a: { enabled: true, bus_id: 8, type: '1541' } }],
    });
    expect(drives).toEqual(['a', 'b']);
  });

  it('resets all connected drives', async () => {
    const resetDrive = vi.fn().mockResolvedValue(undefined);
    await expect(
      resetConnectedDrives(
        { resetDrive },
        {
          drives: [{ a: { enabled: true, bus_id: 8, type: '1541' } }, { b: { enabled: true, bus_id: 9, type: '1541' } }],
        },
      ),
    ).resolves.toEqual({ drives: ['a', 'b'] });
    expect(resetDrive).toHaveBeenCalledTimes(2);
    expect(resetDrive).toHaveBeenNthCalledWith(1, 'a');
    expect(resetDrive).toHaveBeenNthCalledWith(2, 'b');
  });

  it('continues after an individual drive failure and reports context', async () => {
    const resetDrive = vi.fn()
      .mockRejectedValueOnce(new Error('A failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      resetConnectedDrives(
        { resetDrive },
        {
          drives: [{ a: { enabled: true, bus_id: 8, type: '1541' } }, { b: { enabled: true, bus_id: 9, type: '1541' } }],
        },
      ),
    ).rejects.toThrow('Drive A: A failed');

    expect(resetDrive).toHaveBeenCalledTimes(2);
  });

  it('fails fast if there are no connected drives', async () => {
    const resetDrive = vi.fn();
    await expect(resetConnectedDrives({ resetDrive }, { drives: [] })).rejects.toThrow('No connected drives found.');
    expect(resetDrive).not.toHaveBeenCalled();
  });
});

