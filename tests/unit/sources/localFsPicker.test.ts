import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformState = { value: 'web' };

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platformState.value,
  },
}));

const pickDirectoryMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    pickDirectory: (...args: unknown[]) => pickDirectoryMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
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
    ingestLocalArchivesMock.mockReset();
  });

  it('accepts iterable folder picker results on android', async () => {
    pickDirectoryMock.mockResolvedValue({
      files: new Set([{ name: 'song.sid', path: '/song.sid', uri: 'file://song.sid' }]),
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
