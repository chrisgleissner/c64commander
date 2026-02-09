/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRamDumpFileName,
  ensureRamDumpFolder,
  pickRamDumpFile,
  selectRamDumpFolder,
  writeRamDumpToFolder,
} from '@/lib/machine/ramDumpStorage';

const { folderPickerMock, storeMock, platformMock, loggingMock, sidUtilsMock } = vi.hoisted(() => ({
  folderPickerMock: {
    pickDirectory: vi.fn(),
    pickFile: vi.fn(),
    readFile: vi.fn(),
    readFileFromTree: vi.fn(),
    listChildren: vi.fn(),
    getPersistedUris: vi.fn(),
    writeFileToTree: vi.fn(),
  },
  storeMock: {
    loadRamDumpFolderConfig: vi.fn(),
    saveRamDumpFolderConfig: vi.fn(),
    deriveRamDumpFolderDisplayPath: vi.fn((treeUri: string, rootName?: string | null) =>
      rootName ? `Derived/${rootName}` : `Derived/${treeUri}`),
  },
  platformMock: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
  },
  loggingMock: {
    addErrorLog: vi.fn(),
  },
  sidUtilsMock: {
    base64ToUint8: vi.fn((base64: string) => new Uint8Array([1, 2, 3])),
  },
}));

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: folderPickerMock,
}));

vi.mock('@/lib/config/ramDumpFolderStore', () => storeMock);
vi.mock('@/lib/native/platform', () => platformMock);
vi.mock('@/lib/logging', () => loggingMock);
vi.mock('@/lib/sid/sidUtils', () => sidUtilsMock);

describe('ramDumpStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMock.getPlatform.mockReturnValue('android');
    platformMock.isNativePlatform.mockReturnValue(true);
  });

  it('builds RAM dump filename with context and sanitization', () => {
    const name = buildRamDumpFileName(new Date('2026-02-07T03:04:05Z'), 'My context!!');
    expect(name).toBe('c64u-ram-2026-02-07T03-04-05Z-my-context.bin');
  });

  it('builds RAM dump filename without context', () => {
    const name = buildRamDumpFileName(new Date('2026-02-07T03:04:05Z'));
    expect(name).toBe('c64u-ram-2026-02-07T03-04-05Z.bin');
  });

  it('returns stored folder when available', async () => {
    storeMock.loadRamDumpFolderConfig.mockReturnValue({
      treeUri: 'content://stored',
      rootName: 'Stored',
      selectedAt: '2026-02-07T00:00:00.000Z',
    });

    const folder = await ensureRamDumpFolder();

    expect(folder.treeUri).toBe('content://stored');
    expect(folderPickerMock.pickDirectory).not.toHaveBeenCalled();
  });

  it('selects and stores RAM dump folder on native android', async () => {
    storeMock.loadRamDumpFolderConfig.mockReturnValue(null);
    folderPickerMock.pickDirectory.mockResolvedValue({
      treeUri: 'content://new',
      rootName: 'New Folder',
      permissionPersisted: true,
    });

    const folder = await selectRamDumpFolder();

    expect(folder.treeUri).toBe('content://new');
    expect(folder.displayPath).toBe('Derived/New Folder');
    expect(storeMock.saveRamDumpFolderConfig).toHaveBeenCalled();
  });

  it('throws when selecting folder on non-native platform', async () => {
    platformMock.isNativePlatform.mockReturnValue(false);
    await expect(selectRamDumpFolder()).rejects.toThrow('only supported on Android');
  });

  it('throws when folder selection returns invalid result', async () => {
    folderPickerMock.pickDirectory.mockResolvedValue(null);
    await expect(selectRamDumpFolder()).rejects.toThrow('permission could not be persisted');
    
    folderPickerMock.pickDirectory.mockResolvedValue({ treeUri: 'uri', permissionPersisted: false });
    await expect(selectRamDumpFolder()).rejects.toThrow('permission could not be persisted');
  });

  it('writes RAM dump file into selected folder', async () => {
    folderPickerMock.writeFileToTree.mockResolvedValue({
      uri: 'content://file',
      sizeBytes: 4,
    });

    await writeRamDumpToFolder(
      { treeUri: 'content://folder', rootName: 'RAM', selectedAt: '2026-02-07T00:00:00.000Z' },
      'c64u-ram.bin',
      new Uint8Array([1, 2, 3, 4]),
    );

    expect(folderPickerMock.writeFileToTree).toHaveBeenCalledWith(
      expect.objectContaining({
        treeUri: 'content://folder',
        path: '/c64u-ram.bin',
        mimeType: 'application/octet-stream',
      }),
    );
  });

  it('logs and throws write errors', async () => {
    folderPickerMock.writeFileToTree.mockRejectedValue(new Error('Write failed'));
    
    await expect(writeRamDumpToFolder(
      { treeUri: 'content://folder', rootName: 'RAM', selectedAt: '' },
      'file.bin',
      new Uint8Array([])
    )).rejects.toThrow('Write failed');

    expect(loggingMock.addErrorLog).toHaveBeenCalled();
  });

  it('throws writing on non-native platform', async () => {
    platformMock.isNativePlatform.mockReturnValue(false);
    await expect(writeRamDumpToFolder({} as any, 'f', new Uint8Array())).rejects.toThrow('only supported on Android');
  });

  describe('pickRamDumpFile', () => {
    it('picks file on native android', async () => {
      folderPickerMock.pickFile.mockResolvedValue({
        uri: 'content://file.bin',
        permissionPersisted: true,
        name: 'test.bin'
      });
      folderPickerMock.readFile.mockResolvedValue({ data: 'base64' });

      const result = await pickRamDumpFile();
      expect(result.name).toBe('test.bin');
      expect(result.parentFolder).toBeNull();
    });

    it('derives parent folder config from native pick result', async () => {
      folderPickerMock.pickFile.mockResolvedValue({
        uri: 'content://file.bin',
        permissionPersisted: true,
        name: 'test.bin',
        parentTreeUri: 'content://parent',
        parentRootName: 'Parent'
      });
      folderPickerMock.readFile.mockResolvedValue({ data: 'base64' });

      const result = await pickRamDumpFile();
      expect(result.parentFolder).toEqual(expect.objectContaining({
        treeUri: 'content://parent',
        rootName: 'Parent',
        displayPath: 'Derived/Parent'
      }));
    });

    it('throws if native pick fails or permission missing', async () => {
      const call = () => pickRamDumpFile();
      folderPickerMock.pickFile.mockResolvedValue(null);
      await expect(call()).rejects.toThrow('No RAM dump file selected');
      
      folderPickerMock.pickFile.mockResolvedValue({ uri: 'ue', permissionPersisted: false });
      await expect(call()).rejects.toThrow('permission was not granted');
    });

    it('throws if selected file is not .bin (native)', async () => {
      folderPickerMock.pickFile.mockResolvedValue({
        uri: 'content://file.txt',
        permissionPersisted: true,
        name: 'test.txt'
      });
      folderPickerMock.readFile.mockResolvedValue({ data: 'base64' });
      
      await expect(pickRamDumpFile()).rejects.toThrow('Select a .bin');
    });

    it('picks file on web (fallback)', async () => {
      platformMock.isNativePlatform.mockReturnValue(false);
      
      const file = new File(['123'], 'test.bin', { type: 'application/octet-stream' });
      file.arrayBuffer = vi.fn().mockResolvedValue(new Uint8Array([49, 50, 51]).buffer);
      // Stub input element
      const inputMock = {
        click: vi.fn(),
        addEventListener: vi.fn((event, cb) => {
           // Simulate file selection
           Object.defineProperty(inputMock, 'files', { value: [file] });
           cb();
        }),
        files: []
      } as any;
      vi.spyOn(document, 'createElement').mockReturnValue(inputMock);

      const result = await pickRamDumpFile();
      expect(result.name).toBe('test.bin');
      expect(inputMock.click).toHaveBeenCalled();
    });

    it('throws if web file not .bin', async () => {
      platformMock.isNativePlatform.mockReturnValue(false);
      const file = new File(['123'], 'test.txt');
      const inputMock = {
        click: vi.fn(),
        addEventListener: vi.fn((event, cb) => {
           Object.defineProperty(inputMock, 'files', { value: [file] });
           cb();
        }),
        files: []
      } as any;
      vi.spyOn(document, 'createElement').mockReturnValue(inputMock);

      await expect(pickRamDumpFile()).rejects.toThrow('Select a .bin');
    });

    it('throws if web selection cancelled', async () => {
      platformMock.isNativePlatform.mockReturnValue(false);
      const inputMock = {
        click: vi.fn(),
        addEventListener: vi.fn((event, cb) => cb()), // changes but no files
        files: []
      } as any;
      vi.spyOn(document, 'createElement').mockReturnValue(inputMock);

      await expect(pickRamDumpFile()).rejects.toThrow('No RAM dump file selected');
    });
  });
});
