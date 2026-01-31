import { beforeEach, describe, expect, it, vi } from 'vitest';

const listChildrenMock = vi.fn();
let platform = 'android';

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    listChildren: (...args: unknown[]) => listChildrenMock(...args),
  },
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => platform,
}));

import { createLocalSourceLocation } from '@/lib/sourceNavigation/localSourceAdapter';
import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';
import type { LocalSourceRecord } from '@/lib/sourceNavigation/localSourcesStore';

const buildAndroidSource = (): LocalSourceRecord => ({
  id: 'source-1',
  name: 'Android SAF',
  rootName: 'Android SAF',
  rootPath: '/',
  createdAt: new Date().toISOString(),
  entries: undefined,
  android: {
    treeUri: 'content://tree/primary%3AMusic',
    rootName: 'Music',
    permissionGrantedAt: new Date().toISOString(),
  },
});

const buildWebSource = (overrides: Partial<LocalSourceRecord> = {}): LocalSourceRecord => ({
  id: 'source-web',
  name: 'Local Folder',
  rootName: 'Local Folder',
  rootPath: '/',
  createdAt: new Date().toISOString(),
  entries: [
    {
      name: 'song.sid',
      relativePath: 'music/song.sid',
      sizeBytes: 123,
      modifiedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      name: 'readme.txt',
      relativePath: 'music/docs/readme.txt',
      sizeBytes: 45,
      modifiedAt: '2026-01-03T00:00:00.000Z',
    },
  ],
  ...overrides,
});

describe('localSourceAdapter', () => {
  beforeEach(() => {
    listChildrenMock.mockReset();
    platform = 'android';
  });

  it('uses SAF listChildren without touching entries', async () => {
    const source = buildAndroidSource();
    Object.defineProperty(source, 'entries', {
      get: () => {
        throw new Error('entries accessed');
      },
    });
    listChildrenMock.mockResolvedValue({ entries: [] });

    const location = createLocalSourceLocation(source);
    const result = await location.listEntries('/');

    expect(result).toEqual([]);
    expect(listChildrenMock).toHaveBeenCalledWith({ treeUri: source.android?.treeUri, path: '/' });
  });

  it('throws a typed error when SAF listChildren returns invalid entries', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({ entries: { bad: true } });

    const location = createLocalSourceLocation(source);

    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('maps SAF size and modified fields', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'song.sid',
          path: '/song.sid',
          sizeBytes: 1234,
          modifiedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const location = createLocalSourceLocation(source);
    const result = await location.listEntries('/');

    expect(result[0]).toEqual({
      type: 'file',
      name: 'song.sid',
      path: '/song.sid',
      sizeBytes: 1234,
      modifiedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('rejects invalid SAF entries inside the list', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'ok.sid',
          path: '/ok.sid',
        },
        {
          type: 'file',
          name: 12,
          path: '/bad.sid',
        },
      ],
    });

    const location = createLocalSourceLocation(source);

    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('lists SAF files recursively across folders', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockImplementation(({ path }: { path: string }) => {
      if (path === '/') {
        return Promise.resolve({
          entries: [
            { type: 'dir', name: 'Albums', path: '/Albums' },
            { type: 'file', name: 'root.sid', path: '/root.sid' },
          ],
        });
      }
      if (path === '/Albums') {
        return Promise.resolve({
          entries: [{ type: 'file', name: 'deep.sid', path: '/Albums/deep.sid' }],
        });
      }
      return Promise.resolve({ entries: [] });
    });

    const location = createLocalSourceLocation(source);
    const result = await location.listFilesRecursive('/');

    expect(result).toEqual([
      { type: 'file', name: 'root.sid', path: '/root.sid', sizeBytes: null, modifiedAt: null },
      { type: 'file', name: 'deep.sid', path: '/Albums/deep.sid', sizeBytes: null, modifiedAt: null },
    ]);
    expect(listChildrenMock).toHaveBeenCalledWith({ treeUri: source.android?.treeUri, path: '/' });
    expect(listChildrenMock).toHaveBeenCalledWith({ treeUri: source.android?.treeUri, path: '/Albums' });
  });

  it('throws when Android source lacks SAF handle', async () => {
    platform = 'android';
    const source = buildWebSource({ android: undefined });

    const location = createLocalSourceLocation(source);

    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('lists entries from local file list on non-Android platforms', async () => {
    platform = 'web';
    const source = buildWebSource();

    const location = createLocalSourceLocation(source);
    const rootEntries = await location.listEntries('/');
    const musicEntries = await location.listEntries('/music/');

    expect(rootEntries).toEqual([
      { type: 'dir', name: 'music', path: '/music/' },
    ]);
    expect(musicEntries).toEqual([
      { type: 'dir', name: 'docs', path: '/music/docs/' },
      {
        type: 'file',
        name: 'song.sid',
        path: '/music/song.sid',
        sizeBytes: 123,
        modifiedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('filters recursive file listings by prefix', async () => {
    platform = 'web';
    const source = buildWebSource();

    const location = createLocalSourceLocation(source);
    const files = await location.listFilesRecursive('/music');

    expect(files).toEqual([
      { type: 'file', name: 'song.sid', path: '/music/song.sid' },
      { type: 'file', name: 'readme.txt', path: '/music/docs/readme.txt' },
    ]);
  });

  it('marks sources unavailable when reselect is required', () => {
    platform = 'web';
    const source = buildWebSource({ requiresReselect: true });

    const location = createLocalSourceLocation(source);

    expect(location.isAvailable).toBe(false);
  });
});
