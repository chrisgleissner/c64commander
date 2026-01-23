import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformState = { value: 'web' };

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platformState.value,
  },
}));

const pickDirectoryMock = vi.fn();
const readFileMock = vi.fn();
const listChildrenMock = vi.fn();
const readFileFromTreeMock = vi.fn();

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    pickDirectory: (...args: unknown[]) => pickDirectoryMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
    listChildren: (...args: unknown[]) => listChildrenMock(...args),
    readFileFromTree: (...args: unknown[]) => readFileFromTreeMock(...args),
    getPersistedUris: vi.fn(),
  },
}));

const ingestLocalArchivesMock = vi.fn();

vi.mock('@/lib/sources/localArchiveIngestion', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sources/localArchiveIngestion')>(
    '@/lib/sources/localArchiveIngestion',
  );
  return {
    ...actual,
    ingestLocalArchives: (...args: unknown[]) => ingestLocalArchivesMock(...args),
  };
});

import { browseLocalSidFiles } from '@/lib/sources/localFsPicker';

describe('localFsPicker', () => {
  beforeEach(() => {
    platformState.value = 'android';
    pickDirectoryMock.mockReset();
    readFileMock.mockReset();
    listChildrenMock.mockReset();
    readFileFromTreeMock.mockReset();
    ingestLocalArchivesMock.mockReset();
  });

  it('enumerates SAF results on android', async () => {
    const treeUri = 'content://tree/primary%3AMusic';
    pickDirectoryMock.mockResolvedValue({
      treeUri,
      rootName: 'Music',
      permissionPersisted: true,
    });
    listChildrenMock.mockResolvedValue({
      entries: [{ type: 'file', name: 'song.sid', path: '/song.sid' }],
    });
    ingestLocalArchivesMock.mockImplementation(async (files: unknown[]) => ({
      files,
      archiveCount: 0,
      extractedCount: 0,
    }));

    const result = await browseLocalSidFiles(null);
    expect(result).toHaveLength(1);
    expect(result?.[0].name).toBe('song.sid');
    expect(ingestLocalArchivesMock).toHaveBeenCalledTimes(1);
  });
});
