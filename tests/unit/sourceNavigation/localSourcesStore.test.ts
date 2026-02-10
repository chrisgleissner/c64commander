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
      kind: 'directory',
      name: 'Music',
      entries: async function* () {
        yield ['song.sid', fileHandle] as const;
      },
    } as unknown as FileSystemDirectoryHandle;

    (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => directoryHandle;

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.rootName).toBe('song.sid'); // webkitRelativePath takes precedence in simulation?
    // Wait, in `createLocalSourceFromFileList`, rootName comes from first file's relative path or label.
    // Here, we mocked walkDirectory, setting relativePath.
    // In `createLocalSourceFromPicker`:
    // file.webkitRelativePath = prefix + name.
    // prefix is '' initially. name is 'song.sid'.
    // So relativePath is 'song.sid'.
    // rootName in createLocalSourceFromFileList = first?.webkitRelativePath?.split('/')?.[0] || label.
    // 'song.sid'.split('/')[0] is 'song.sid'.
    // The label passed is directoryHandle.name ('Music').
    // But relativePath takes precedence if it exists?
    // In createLocalSourceFromFileList:
    // const rootName = first?.webkitRelativePath?.split('/')?.[0] || label || 'Folder';
    // 'song.sid' vs label 'Music'. 'song.sid' wins.

    expect(result?.source.entries).toHaveLength(1);
  });

  it('recurses into subdirectories on web', async () => {
    const song = createFile('tune.sid', 'SID');
    const fileHandle = {
      kind: 'file',
      getFile: async () => song,
    } as unknown as FileSystemFileHandle;

    const nestedDirHandle = {
      kind: 'directory',
      entries: async function* () {
        yield ['tune.sid', fileHandle] as const;
      }
    } as unknown as FileSystemDirectoryHandle;

    const rootDirHandle = {
      kind: 'directory',
      name: 'Root',
      entries: async function* () {
        yield ['Nested', nestedDirHandle] as const;
      },
    } as unknown as FileSystemDirectoryHandle;

    (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => rootDirHandle;

    const result = await createLocalSourceFromPicker(null);
    expect(result?.source.entries).toHaveLength(1);
    expect(result?.source.entries?.[0].relativePath).toBe('Nested/tune.sid');
  });

  describe('Validation and Normalization', () => {
    it('clears corrupted entries from localStorage', () => {
      localStorage.setItem('c64u_local_sources:v1', 'invalid-json');
      expect(loadLocalSources()).toEqual([]);
    });

    it('normalizes SAF sources by removing entries and ensuring rootPath /', () => {
      const raw = [{
        id: 'saf1',
        name: 'Saf',
        createdAt: 'now',
        entries: [{ name: 'ignored', relativePath: 'ignored' }],
        android: { treeUri: 'content://tree', rootName: 'Saf', permissionGrantedAt: 'now' }
      }];
      saveLocalSources(raw as any);
      const loaded = loadLocalSources();
      expect(loaded[0].entries).toBeUndefined();
      expect(loaded[0].rootPath).toBe('/');
    });

    it('normalizes entries array for non-SAF sources', () => {
      const raw = [{
        id: 'local1',
        name: 'Local',
        createdAt: 'now',
        // entries missing
      }];
      saveLocalSources(raw as any);
      const loaded = loadLocalSources();
      expect(Array.isArray(loaded[0].entries)).toBe(true);
      expect(loaded[0].entries).toHaveLength(0);
      expect(loaded[0].rootPath).toBe('/');
    });
  });

  describe('Android SAF Errors', () => {
    beforeEach(() => {
      platformState.value = 'android';
      platformState.native = true;
    });

    it('throws when SAF picker fails', async () => {
      pickDirectoryMock.mockRejectedValue(new Error('User cancelled'));
      await expect(createLocalSourceFromPicker(null)).rejects.toThrow('User cancelled');
    });

    it('throws when SAF permission cannot be persisted', async () => {
      pickDirectoryMock.mockResolvedValue({
        treeUri: 'content://tree',
        rootName: 'Test',
        permissionPersisted: false,
      });
      await expect(createLocalSourceFromPicker(null)).rejects.toThrow('Folder access permission could not be persisted');
    });
  });

  describe('createLocalSourceFromFileList Edge Cases', () => {
    it('handles empty file list', () => {
      const result = createLocalSourceFromFileList([]);
      expect(result.source.name).toBe('Folder');
      expect(result.source.entries).toHaveLength(0);
    });

    it('uses label when first file has no relative path root', () => {
      const file = createFile('test.sid');
      // @ts-ignore
      delete file.webkitRelativePath;
      const result = createLocalSourceFromFileList([file], 'MyLabel');
      expect(result.source.name).toBe('MyLabel');
      expect(result.source.entries?.[0].relativePath).toBe('MyLabel/test.sid');
    });

    it('prepends label to flat files', () => {
      const file = createFile('test.sid');
      // Standard file drop has empty webkitRelativePath
      Object.defineProperty(file, 'webkitRelativePath', { value: '' });
      const result = createLocalSourceFromFileList([file], 'Drop');
      expect(result.source.name).toBe('Drop');
      expect(result.source.entries?.[0].relativePath).toBe('Drop/test.sid');
    });

    it('strips leading slashes from relative paths', () => {
      const file = createFile('test.sid');
      Object.defineProperty(file, 'webkitRelativePath', { value: '/folder/test.sid' });
      const result = createLocalSourceFromFileList([file]);
      expect(result.source.entries?.[0].relativePath).toBe('folder/test.sid');
    });
  });

  describe('prepareDirectoryInput', () => {
    it('sets attributes on input', () => {
      const input = document.createElement('input');
      prepareDirectoryInput(input);
      expect(input.hasAttribute('webkitdirectory')).toBe(true);
      expect(input.hasAttribute('directory')).toBe(true);
    });

    it('does nothing if input is null', () => {
      expect(() => prepareDirectoryInput(null)).not.toThrow();
    });
  });

  describe('Random ID Generation', () => {
    it('falls back to timestamp when crypto is unavailable', () => {
      const originalCrypto = globalThis.crypto;
      // @ts-ignore
      delete globalThis.crypto;

      // Trigger creation which calls safeRandomId
      const result = createLocalSourceFromFileList([]);
      expect(result.source.id).toMatch(/^local-\d+-[0-9a-f]+$/);

      globalThis.crypto = originalCrypto;
    });
  });
});
import { requireLocalSourceEntries, getLocalSourceListingMode } from '@/lib/sourceNavigation/localSourcesStore';

describe('requireLocalSourceEntries', () => {
  it('throws for SAF sources', () => {
    const source = {
      id: 's1',
      android: { treeUri: 'content://tree' }
    } as any;
    expect(() => requireLocalSourceEntries(source, 'test')).toThrow('SAF sources do not expose entry listings');
    expect(getLocalSourceListingMode(source)).toBe('saf');
  });

  it('throws for missing entries in non-SAF sources', () => {
    const source = { id: 's2' } as any;
    expect(() => requireLocalSourceEntries(source, 'test')).toThrow('Local source entries are missing or invalid');
    expect(getLocalSourceListingMode(source)).toBe('entries');
  });

  it('returns entries when valid', () => {
    const entries = [{ name: 'f', relativePath: 'f' }];
    const source = { id: 's3', entries } as any;
    expect(requireLocalSourceEntries(source, 'test')).toBe(entries);
  });
});

