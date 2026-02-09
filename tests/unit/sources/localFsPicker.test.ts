/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformState = { value: 'web' };

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platformState.value,
    isNativePlatform: () => false,
  },
  registerPlugin: vi.fn(() => ({})),
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

const buildAsyncEntries = (entries: [string, { kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File>; entries?: () => AsyncIterableIterator<[string, any]>; }][] ) =>
  (async function* iterator() {
    for (const entry of entries) {
      yield entry as [string, any];
    }
  })();

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

  it('falls back to input click when directory picker is unavailable on web', async () => {
    platformState.value = 'web';
    const input = { click: vi.fn() } as unknown as HTMLInputElement;

    const result = await browseLocalSidFiles(input);

    expect(result).toBeNull();
    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it('walks directory picker entries on web and filters supported files', async () => {
    platformState.value = 'web';

    const fileOne = new File([new Uint8Array([1, 2, 3])], 'Track.sid', { type: 'application/octet-stream' });
    const fileTwo = new File([new Uint8Array([4, 5])], 'Readme.txt', { type: 'text/plain' });

    const fileHandle = {
      kind: 'file',
      name: 'Track.sid',
      getFile: () => Promise.resolve(fileOne),
    };
    const ignoredHandle = {
      kind: 'file',
      name: 'Readme.txt',
      getFile: () => Promise.resolve(fileTwo),
    };
    const nestedFile = {
      kind: 'file',
      name: 'Nested.sid',
      getFile: () => Promise.resolve(new File([new Uint8Array([9])], 'Nested.sid')),
    };
    const nestedDir = {
      kind: 'directory',
      name: 'Nested',
      entries: () => buildAsyncEntries([
        ['Nested.sid', nestedFile],
      ]),
    };

    const rootHandle = {
      kind: 'directory',
      name: 'Root',
      entries: () => buildAsyncEntries([
        ['Track.sid', fileHandle],
        ['Readme.txt', ignoredHandle],
        ['Nested', nestedDir],
      ]),
    };

    const showDirectoryPicker = vi.fn().mockResolvedValue(rootHandle);
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: showDirectoryPicker,
      configurable: true,
    });

    ingestLocalArchivesMock.mockImplementation(async (files: File[]) => ({
      files,
      archiveCount: 0,
      extractedCount: 0,
    }));

    const result = await browseLocalSidFiles(null);

    expect(showDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result?.map((file) => file.name)).toEqual(['Track.sid', 'Nested.sid']);
    expect(ingestLocalArchivesMock).toHaveBeenCalledWith(expect.any(Array));
  });
});
