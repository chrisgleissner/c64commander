import { describe, it, expect, vi } from 'vitest';
import type { C64API } from '@/lib/c64api';
import { mountDiskToDrive } from '@/lib/disks/diskMount';
import { createDiskEntry } from '@/lib/disks/diskTypes';

describe('mountDiskToDrive', () => {
  it('mounts ultimate disks via mountDrive', async () => {
    const api = {
      mountDrive: vi.fn().mockResolvedValue(undefined),
      mountDriveUpload: vi.fn(),
    } as unknown as C64API;

    const disk = createDiskEntry({
      location: 'ultimate',
      path: '/Usb0/Games/Turrican II/Disk 1.d64',
    });

    await mountDiskToDrive(api, 'a', disk);

    expect(api.mountDrive).toHaveBeenCalledWith('a', disk.path, 'd64', 'readwrite');
    expect(api.mountDriveUpload).not.toHaveBeenCalled();
  });

  it('mounts local disks via upload when runtime file is provided', async () => {
    const api = {
      mountDrive: vi.fn(),
      mountDriveUpload: vi.fn().mockResolvedValue(undefined),
    } as unknown as C64API;

    const disk = createDiskEntry({
      location: 'local',
      path: '/Local/Disk 1.d64',
    });

    const runtimeFile = new File([new Uint8Array([1, 2, 3])], 'Disk 1.d64', {
      type: 'application/octet-stream',
    });

    await mountDiskToDrive(api, 'b', disk, runtimeFile);

    expect(api.mountDriveUpload).toHaveBeenCalled();
    const [drive, blob, mountType, access] = (api.mountDriveUpload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(drive).toBe('b');
    expect(blob).toBeInstanceOf(Blob);
    expect(mountType).toBe('d64');
    expect(access).toBe('readwrite');
    expect(api.mountDrive).not.toHaveBeenCalled();
  });
});
