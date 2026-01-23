import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformState = { value: 'web' };

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platformState.value,
  },
}));

const pickDirectoryMock = vi.fn();

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    pickDirectory: (...args: unknown[]) => pickDirectoryMock(...args),
  },
}));

import {
  createLocalSourceFromFileList,
  createLocalSourceFromPicker,
  getLocalSourceRuntimeFile,
  loadLocalSources,
  saveLocalSources,
  setLocalSourceRuntimeFiles,
  prepareDirectoryInput,
} from '@/lib/sourceNavigation/localSourcesStore';

const createFile = (name: string, content: string, relativePath?: string) => {
  const file = new File([content], name, { type: 'text/plain', lastModified: Date.now() });
  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  }
  return file;
};

describe('localSourcesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    pickDirectoryMock.mockReset();
    platformState.value = 'web';
  });

  it('creates a local source from file list and tracks runtime files', () => {
    const files = [
      createFile('song.sid', 'SID', 'MyFolder/song.sid'),
      createFile('note.txt', 'TXT', 'MyFolder/note.txt'),
    ];

    const result = createLocalSourceFromFileList(files);
    expect(result.source.rootName).toBe('MyFolder');
    expect(result.source.entries).toHaveLength(2);
    expect(result.runtimeFiles['/MyFolder/song.sid']).toBeDefined();

    setLocalSourceRuntimeFiles(result.source.id, result.runtimeFiles);
    expect(getLocalSourceRuntimeFile(result.source.id, 'MyFolder/song.sid')).toBe(files[0]);
  });

  it('saves and loads local sources from storage', () => {
    const sources = [
      {
        id: 'source-1',
        name: 'Local',
        rootName: 'Local',
        rootPath: '/Local/',
        createdAt: new Date().toISOString(),
        entries: [],
      },
    ];

    saveLocalSources(sources);
    expect(loadLocalSources()).toEqual(sources);
  });

  it('prepares directory input attributes', () => {
    const input = document.createElement('input');
    prepareDirectoryInput(input);
    expect(input.getAttribute('webkitdirectory')).toBe('');
    expect(input.getAttribute('directory')).toBe('');
  });

  it('uses native folder picker on android', async () => {
    platformState.value = 'android';
    pickDirectoryMock.mockResolvedValue({
      rootName: 'Phone',
      files: [
        { name: 'song.sid', path: '/Phone/song.sid', uri: 'file://song.sid' },
      ],
    });

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.rootName).toBe('Phone');
    expect(result?.source.entries).toHaveLength(1);
  });

  it('accepts iterable folder picker results on android', async () => {
    platformState.value = 'android';
    pickDirectoryMock.mockResolvedValue({
      rootName: 'Phone',
      files: new Set([{ name: 'song.sid', path: '/Phone/song.sid', uri: 'file://song.sid' }]),
    });

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.entries).toHaveLength(1);
  });

  it('normalizes missing picker paths on android', async () => {
    platformState.value = 'android';
    pickDirectoryMock.mockResolvedValue({
      rootName: 'Phone',
      files: [{ name: 'song.sid', uri: 'file://song.sid' }],
    });

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.entries).toHaveLength(1);
    expect(result?.source.entries[0].relativePath).toBe('song.sid');
  });

  it('falls back to input click when directory picker is unavailable', async () => {
    const input = document.createElement('input');
    const clickSpy = vi.spyOn(input, 'click');
    (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = undefined;

    const result = await createLocalSourceFromPicker(input);
    expect(result).toBeNull();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('walks directory picker entries on web', async () => {
    const song = createFile('song.sid', 'SID');
    const fileHandle = {
      kind: 'file',
      getFile: async () => song,
    } as unknown as FileSystemFileHandle;

    const directoryHandle = {
      name: 'Music',
      entries: async function* () {
        yield ['song.sid', fileHandle] as const;
      },
    } as unknown as FileSystemDirectoryHandle;

    (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => directoryHandle;

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.rootName).toBe('song.sid');
    expect(result?.source.entries).toHaveLength(1);
  });
});
