/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addErrorLog, addLog } = vi.hoisted(() => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock('@/lib/logging', () => ({ addErrorLog, addLog }));

const { mkdir, writeFile, readFile, deleteFile } = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: { mkdir, writeFile, readFile, deleteFile },
}));

const { ensureRamDumpFolder, writeRamDumpToFolder } = vi.hoisted(() => ({
  ensureRamDumpFolder: vi.fn(),
  writeRamDumpToFolder: vi.fn(),
}));
vi.mock('@/lib/machine/ramDumpStorage', () => ({ ensureRamDumpFolder, writeRamDumpToFolder }));

const { readFileFromTree } = vi.hoisted(() => ({ readFileFromTree: vi.fn() }));
vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: { readFileFromTree },
}));

const { getPlatform, isNativePlatform } = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'web'),
  isNativePlatform: vi.fn(() => false),
}));
vi.mock('@/lib/native/platform', () => ({ getPlatform, isNativePlatform }));

const { deriveRamDumpFolderDisplayPath } = vi.hoisted(() => ({
  deriveRamDumpFolderDisplayPath: vi.fn(() => 'DISPLAY_PATH'),
}));
vi.mock('@/lib/config/ramDumpFolderStore', () => ({ deriveRamDumpFolderDisplayPath }));

const { base64ToUint8 } = vi.hoisted(() => ({
  base64ToUint8: vi.fn((v: string) => new Uint8Array(Buffer.from(v, 'base64'))),
}));
vi.mock('@/lib/sid/sidUtils', () => ({ base64ToUint8 }));

import {
  persistReuSnapshotFile,
  readReuSnapshotBytes,
  deleteReuSnapshotFile,
} from '@/lib/reu/reuSnapshotStorage';
import type { ReuSnapshotStorageEntry } from '@/lib/reu/reuSnapshotTypes';

const makeAndroidEntry = (path = '/test.reu'): ReuSnapshotStorageEntry => ({
  id: 'e1',
  label: 'Test',
  sizeBytes: 64,
  createdAt: '2026-01-01T00:00:00Z',
  storage: {
    kind: 'android-tree',
    treeUri: 'content://com.example/tree',
    path,
    rootName: 'Downloads',
    displayPath: 'Downloads',
  },
});

const makeNativeEntry = (path = 'reu-snapshots/test.reu'): ReuSnapshotStorageEntry => ({
  id: 'e1',
  label: 'Test',
  sizeBytes: 64,
  createdAt: '2026-01-01T00:00:00Z',
  storage: { kind: 'native-data', path },
});

describe('reuSnapshotStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlatform.mockReturnValue('web');
    isNativePlatform.mockReturnValue(false);
  });

  describe('persistReuSnapshotFile', () => {
    it('saves to android-tree when platform is android and native', async () => {
      getPlatform.mockReturnValue('android');
      isNativePlatform.mockReturnValue(true);
      ensureRamDumpFolder.mockResolvedValue({
        treeUri: 'content://tree',
        rootName: 'Downloads',
        displayPath: 'Downloads',
      });
      writeRamDumpToFolder.mockResolvedValue(undefined);

      const result = await persistReuSnapshotFile('test snapshot', new Uint8Array([1, 2, 3]));

      expect(ensureRamDumpFolder).toHaveBeenCalledTimes(1);
      expect(writeRamDumpToFolder).toHaveBeenCalledWith(
        expect.objectContaining({ treeUri: 'content://tree' }),
        'test-snapshot.reu',
        expect.any(Uint8Array),
      );
      expect(result.kind).toBe('android-tree');
      expect(result).toMatchObject({
        kind: 'android-tree',
        treeUri: 'content://tree',
        path: '/test-snapshot.reu',
        rootName: 'Downloads',
      });
    });

    it('derives displayPath when folder has no displayPath', async () => {
      getPlatform.mockReturnValue('android');
      isNativePlatform.mockReturnValue(true);
      ensureRamDumpFolder.mockResolvedValue({
        treeUri: 'content://tree',
        rootName: 'Downloads',
        displayPath: null,
      });
      writeRamDumpToFolder.mockResolvedValue(undefined);
      deriveRamDumpFolderDisplayPath.mockReturnValue('Derived/Path');

      const result = await persistReuSnapshotFile('snap.reu', new Uint8Array([0]));

      expect(deriveRamDumpFolderDisplayPath).toHaveBeenCalledWith('content://tree', 'Downloads');
      expect((result as { displayPath: string }).displayPath).toBe('Derived/Path');
    });

    it('throws when not on native platform and not android', async () => {
      getPlatform.mockReturnValue('web');
      isNativePlatform.mockReturnValue(false);

      await expect(persistReuSnapshotFile('file.reu', new Uint8Array([0]))).rejects.toThrow(
        'REU snapshots are only supported on native builds.',
      );
    });

    it('saves to native-data when native but not android', async () => {
      getPlatform.mockReturnValue('ios');
      isNativePlatform.mockReturnValue(true);
      mkdir.mockResolvedValue(undefined);
      writeFile.mockResolvedValue(undefined);

      const result = await persistReuSnapshotFile('my snapshot', new Uint8Array([0xff]));

      expect(mkdir).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'reu-snapshots', recursive: true }),
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'reu-snapshots/my-snapshot.reu' }),
      );
      expect(result.kind).toBe('native-data');
      expect((result as { path: string }).path).toBe('reu-snapshots/my-snapshot.reu');
    });

    it('sanitizes empty filename to fallback name', async () => {
      getPlatform.mockReturnValue('ios');
      isNativePlatform.mockReturnValue(true);
      mkdir.mockResolvedValue(undefined);
      writeFile.mockResolvedValue(undefined);

      const result = await persistReuSnapshotFile('   ', new Uint8Array([]));
      expect((result as { path: string }).path).toBe('reu-snapshots/reu-snapshot.reu');
    });

    it('does not duplicate .reu extension', async () => {
      getPlatform.mockReturnValue('ios');
      isNativePlatform.mockReturnValue(true);
      mkdir.mockResolvedValue(undefined);
      writeFile.mockResolvedValue(undefined);

      const result = await persistReuSnapshotFile('backup.reu', new Uint8Array([]));
      expect((result as { path: string }).path).toBe('reu-snapshots/backup.reu');
    });

    it('replaces special characters in filename', async () => {
      getPlatform.mockReturnValue('ios');
      isNativePlatform.mockReturnValue(true);
      mkdir.mockResolvedValue(undefined);
      writeFile.mockResolvedValue(undefined);

      const result = await persistReuSnapshotFile('my:snapshot//v2!', new Uint8Array([]));
      expect((result as { path: string }).path).toMatch(/reu-snapshots\/my-snapshot-v2.reu/);
    });
  });

  describe('readReuSnapshotBytes', () => {
    it('reads android-tree entry via FolderPicker', async () => {
      readFileFromTree.mockResolvedValue({ data: btoa('hello') });

      const entry = makeAndroidEntry('/hello.reu');
      const result = await readReuSnapshotBytes(entry);

      expect(readFileFromTree).toHaveBeenCalledWith({
        treeUri: 'content://com.example/tree',
        path: '/hello.reu',
      });
      expect(base64ToUint8).toHaveBeenCalledWith(btoa('hello'));
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('reads native-data entry via Filesystem.readFile', async () => {
      readFile.mockResolvedValue({ data: btoa('world') });

      const entry = makeNativeEntry('reu-snapshots/world.reu');
      const result = await readReuSnapshotBytes(entry);

      expect(readFile).toHaveBeenCalledWith({
        directory: 'DATA',
        path: 'reu-snapshots/world.reu',
      });
      expect(base64ToUint8).toHaveBeenCalledWith(btoa('world'));
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('deleteReuSnapshotFile', () => {
    it('deletes native-data entry via Filesystem.deleteFile', async () => {
      deleteFile.mockResolvedValue(undefined);

      await deleteReuSnapshotFile(makeNativeEntry());

      expect(deleteFile).toHaveBeenCalledWith({
        directory: 'DATA',
        path: 'reu-snapshots/test.reu',
      });
    });

    it('logs error and does not rethrow when delete fails for native-data', async () => {
      deleteFile.mockRejectedValue(new Error('disk error'));

      await expect(deleteReuSnapshotFile(makeNativeEntry())).resolves.toBeUndefined();
      expect(addErrorLog).toHaveBeenCalledWith(
        'Failed to delete REU snapshot file',
        expect.objectContaining({ error: 'disk error' }),
      );
    });

    it('logs warning when entry is android-tree (SAF tree delete skipped)', async () => {
      await deleteReuSnapshotFile(makeAndroidEntry());

      expect(deleteFile).not.toHaveBeenCalled();
      expect(addLog).toHaveBeenCalledWith(
        'warn',
        'REU snapshot file delete skipped for Android SAF tree',
        expect.objectContaining({ treeUri: 'content://com.example/tree' }),
      );
    });
  });
});
