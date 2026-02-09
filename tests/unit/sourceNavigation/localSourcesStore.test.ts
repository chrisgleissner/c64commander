/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformState = { value: 'web', native: false };

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platformState.value,
    isNativePlatform: () => platformState.native,
  },
  registerPlugin: vi.fn(() => ({})),
}));

const pickDirectoryMock = vi.fn();

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    pickDirectory: (...args: unknown[]) => pickDirectoryMock(...args),
    listChildren: vi.fn(),
    getPersistedUris: vi.fn(),
    readFile: vi.fn(),
    readFileFromTree: vi.fn(),
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
    platformState.native = false;
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
    const loaded = loadLocalSources();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].entries).toHaveLength(0);
  });

  it('prepares directory input attributes', () => {
    const input = document.createElement('input');
    prepareDirectoryInput(input);
    expect(input.getAttribute('webkitdirectory')).toBe('');
    expect(input.getAttribute('directory')).toBe('');
  });

  it('uses native folder picker on android', async () => {
    platformState.value = 'android';
    platformState.native = true;
    pickDirectoryMock.mockResolvedValue({
      treeUri: 'content://tree/primary%3AMusic',
      rootName: 'Phone',
      permissionPersisted: true,
    });

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.rootName).toBe('Phone');
    expect(result?.source.entries).toBeUndefined();
    expect(result?.source.android?.treeUri).toBe('content://tree/primary%3AMusic');
  });

  it('keeps rootPath as / for SAF sources regardless of rootName', async () => {
    platformState.value = 'android';
    platformState.native = true;
    pickDirectoryMock.mockResolvedValue({
      treeUri: 'content://tree/primary%3AMusic%2FDemos',
      rootName: 'Demos',
      permissionPersisted: true,
    });

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.rootPath).toBe('/');
    expect(result?.source.rootName).toBe('Demos');
  });

  it('defaults rootPath to / when rootName is empty', async () => {
    platformState.value = 'android';
    platformState.native = true;
    pickDirectoryMock.mockResolvedValue({
      treeUri: 'content://tree/primary%3AMusic',
      rootName: '',
      permissionPersisted: true,
    });

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.rootPath).toBe('/');
  });

  it('persists and restores SAF source with treeUri across save/load', async () => {
    platformState.value = 'android';
    platformState.native = true;
    pickDirectoryMock.mockResolvedValue({
      treeUri: 'content://tree/primary%3AMusic',
      rootName: 'SID Collection',
      permissionPersisted: true,
    });

    const result = await createLocalSourceFromPicker(null);
    expect(result).not.toBeNull();
    saveLocalSources([result!.source]);

    const loaded = loadLocalSources();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].android?.treeUri).toBe('content://tree/primary%3AMusic');
    expect(loaded[0].rootPath).toBe('/');
    expect(loaded[0].rootName).toBe('SID Collection');
    expect(loaded[0].id).toBe(result!.source.id);
  });

  it('rejects picker payloads with file listings on android', async () => {
    platformState.value = 'android';
    platformState.native = true;
    pickDirectoryMock.mockResolvedValue({
      treeUri: 'content://tree/primary%3AMusic',
      rootName: 'Phone',
      permissionPersisted: true,
      files: [{ name: 'song.sid', path: '/Phone/song.sid', uri: 'file://song.sid' }],
    });

    await expect(createLocalSourceFromPicker(null)).rejects.toThrow('Android SAF picker returned an unsupported response.');
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
