import { describe, expect, it, vi } from 'vitest';
import {
  buildDiskId,
  createDiskEntry,
  getDiskFolderPath,
  getDiskName,
  getLeafFolderName,
  getLocationLabel,
  isDiskImagePath,
  normalizeDiskPath,
} from '@/lib/disks/diskTypes';

describe('diskTypes helpers', () => {
  it('normalizes disk paths and builds ids', () => {
    expect(normalizeDiskPath('')).toBe('/');
    expect(normalizeDiskPath(' Usb0//Games ')).toBe('/Usb0/Games');
    expect(buildDiskId('ultimate', 'Usb0//Games')).toBe('ultimate:/Usb0/Games');
  });

  it('derives disk names and folder paths', () => {
    expect(getDiskName('/Usb0/Games/Disk 1.d64')).toBe('Disk 1.d64');
    expect(getDiskName('/')).toBe('/');
    expect(getDiskFolderPath('/Usb0/Games/Disk 1.d64')).toBe('/Usb0/Games/');
    expect(getDiskFolderPath('/Disk 1.d64')).toBe('/');
  });

  it('detects disk images and leaf folder names', () => {
    expect(isDiskImagePath('/Usb0/Games/Disk 1.d64')).toBe(true);
    expect(getLeafFolderName('/Usb0/Games/Disk 1.d64')).toBe('Games');
    expect(getLeafFolderName('/Usb0/Games/')).toBe('Games');
    expect(getLeafFolderName('/')).toBeNull();
  });

  it('creates disk entries with defaults', () => {
    const nowSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-01-01T00:00:00Z');
    const entry = createDiskEntry({
      path: 'Usb0/Games/Disk 1.d64',
      location: 'local',
      group: 'Games',
      localUri: 'content://disk-1',
      sizeBytes: 1234,
      modifiedAt: '2024-01-01T00:00:00Z',
      importOrder: 2,
    });

    expect(entry.id).toBe('local:/Usb0/Games/Disk 1.d64');
    expect(entry.name).toBe('Disk 1.d64');
    expect(entry.path).toBe('/Usb0/Games/Disk 1.d64');
    expect(entry.group).toBe('Games');
    expect(entry.localUri).toBe('content://disk-1');
    expect(entry.sizeBytes).toBe(1234);
    expect(entry.modifiedAt).toBe('2024-01-01T00:00:00Z');
    expect(entry.importedAt).toBe('2024-01-01T00:00:00Z');
    expect(entry.importOrder).toBe(2);

    nowSpy.mockRestore();
  });

  it('returns location labels', () => {
    expect(getLocationLabel('local')).toBe('Local');
    expect(getLocationLabel('ultimate')).toBe('C64U');
  });
});