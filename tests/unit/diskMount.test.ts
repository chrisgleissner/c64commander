/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { C64API } from '@/lib/c64api';
import { mountDiskToDrive, resolveLocalDiskBlob } from '@/lib/disks/diskMount';
import { createDiskEntry } from '@/lib/disks/diskTypes';
import { saveLocalSources, setLocalSourceRuntimeFiles } from '@/lib/sourceNavigation/localSourcesStore';

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    readFile: vi.fn(),
    readFileFromTree: vi.fn(),
  },
}));

const mockFolderPicker = async (data: string) => {
  const { FolderPicker } = await import('@/lib/native/folderPicker');
  (FolderPicker.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({ data });
};

const mockFolderPickerFromTree = async (data: string) => {
  const { FolderPicker } = await import('@/lib/native/folderPicker');
  (FolderPicker.readFileFromTree as ReturnType<typeof vi.fn>).mockResolvedValue({ data });
};

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(blob);
  });

describe('mountDiskToDrive', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mounts ultimate disks via mountDrive', async () => {
    const api = {
      mountDrive: vi.fn().mockResolvedValue(undefined),
      mountDriveUpload: vi.fn(),
      getBaseUrl: vi.fn().mockReturnValue('http://c64u'),
      getDeviceHost: vi.fn().mockReturnValue('c64u'),
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
      getBaseUrl: vi.fn().mockReturnValue('http://c64u'),
      getDeviceHost: vi.fn().mockReturnValue('c64u'),
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

  it('resolves local disk blobs from FolderPicker data', async () => {
    await mockFolderPicker(btoa('demo'));
    const disk = createDiskEntry({
      location: 'local',
      path: '/Local/Disk 2.d64',
      localUri: 'content://demo/disk2',
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob.'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsText(blob);
    });

    expect(text).toBe('demo');
  });

  it('resolves local disk blobs from SAF tree URIs', async () => {
    await mockFolderPickerFromTree(btoa('tree-data'));
    const disk = createDiskEntry({
      location: 'local',
      path: '/Local/Disk 2.d64',
      localTreeUri: 'content://tree/primary%3ADisks',
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob.'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsText(blob);
    });

    expect(text).toBe('tree-data');
  });

  it('throws when local disks are missing a URI', async () => {
    const disk = createDiskEntry({
      location: 'local',
      path: '/Local/Disk 3.d64',
    });

    await expect(resolveLocalDiskBlob(disk)).rejects.toThrow('Local disk access is missing.');
  });

  it('resolves local disk blobs via source runtime files', async () => {
    const sourceId = 'source-runtime';
    saveLocalSources([
      {
        id: sourceId,
        name: 'Local Source',
        rootName: 'Local Source',
        rootPath: '/',
        createdAt: new Date().toISOString(),
        entries: [],
      },
    ]);

    const runtimeFile = new File([new Uint8Array([100, 101, 102])], 'Disk 4.d64', {
      type: 'application/octet-stream',
    });
    setLocalSourceRuntimeFiles(sourceId, {
      '/Local/Disk 4.d64': runtimeFile,
    });

    const disk = createDiskEntry({
      location: 'local',
      path: '/Local/Disk 4.d64',
      sourceId,
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await readBlobText(blob);
    expect(text).toBe('def');
  });

  it('resolves local disk blobs via source SAF tree URIs', async () => {
    await mockFolderPickerFromTree(btoa('saf-data'));
    const sourceId = 'source-saf';
    saveLocalSources([
      {
        id: sourceId,
        name: 'Android SAF',
        rootName: 'Android SAF',
        rootPath: '/',
        createdAt: new Date().toISOString(),
        android: {
          treeUri: 'content://tree/primary%3ADisks',
          rootName: 'Disks',
          permissionGrantedAt: new Date().toISOString(),
        },
      },
    ]);

    const disk = createDiskEntry({
      location: 'local',
      path: '/Local/Disk 5.d64',
      sourceId,
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await readBlobText(blob);
    expect(text).toBe('saf-data');
  });
});
