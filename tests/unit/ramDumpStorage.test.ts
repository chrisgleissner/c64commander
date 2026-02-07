import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRamDumpFileName,
  ensureRamDumpFolder,
  pickRamDumpFile,
  selectRamDumpFolder,
  writeRamDumpToFolder,
} from '@/lib/machine/ramDumpStorage';

const { folderPickerMock, storeMock, platformMock } = vi.hoisted(() => ({
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
  },
  platformMock: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
  },
}));

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: folderPickerMock,
}));

vi.mock('@/lib/config/ramDumpFolderStore', () => storeMock);

vi.mock('@/lib/native/platform', () => platformMock);

describe('ramDumpStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMock.getPlatform.mockReturnValue('android');
    platformMock.isNativePlatform.mockReturnValue(true);
  });

  it('builds RAM dump filename with expected format', () => {
    const name = buildRamDumpFileName(new Date('2026-02-07T03:04:05'));
    expect(name).toBe('c64u-ram-03-04-05.bin');
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

  it('selects and stores RAM dump folder', async () => {
    storeMock.loadRamDumpFolderConfig.mockReturnValue(null);
    folderPickerMock.pickDirectory.mockResolvedValue({
      treeUri: 'content://new',
      rootName: 'New Folder',
      permissionPersisted: true,
    });

    const folder = await selectRamDumpFolder();

    expect(folder.treeUri).toBe('content://new');
    expect(storeMock.saveRamDumpFolderConfig).toHaveBeenCalled();
  });

  it('writes RAM dump file into selected folder', async () => {
    folderPickerMock.writeFileToTree.mockResolvedValue({
      uri: 'content://file',
      sizeBytes: 4,
    });

    await writeRamDumpToFolder(
      { treeUri: 'content://folder', rootName: 'RAM', selectedAt: '2026-02-07T00:00:00.000Z' },
      'c64u-ram-01-02-03.bin',
      new Uint8Array([1, 2, 3, 4]),
    );

    expect(folderPickerMock.writeFileToTree).toHaveBeenCalledWith(
      expect.objectContaining({
        treeUri: 'content://folder',
        path: '/c64u-ram-01-02-03.bin',
        mimeType: 'application/octet-stream',
      }),
    );
  });

  it('picks RAM dump file and returns bytes', async () => {
    folderPickerMock.pickFile.mockResolvedValue({
      uri: 'content://ramfile',
      name: 'saved.bin',
      sizeBytes: 65536,
      modifiedAt: '2026-02-07T00:00:00.000Z',
      permissionPersisted: true,
    });
    folderPickerMock.readFile.mockResolvedValue({ data: Buffer.from([1, 2, 3]).toString('base64') });

    const picked = await pickRamDumpFile();

    expect(picked.name).toBe('saved.bin');
    expect(Array.from(picked.bytes)).toEqual([1, 2, 3]);
  });
});
