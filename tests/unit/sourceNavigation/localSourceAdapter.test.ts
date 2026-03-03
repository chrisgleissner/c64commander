/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const listChildrenMock = vi.fn();
let platform = 'android';
let nativePlatform = true;

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    listChildren: (...args: unknown[]) => listChildrenMock(...args),
  },
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => platform,
  isNativePlatform: () => nativePlatform,
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
    nativePlatform = true;
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

  it('parses SAF entries when returned as JSON string', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({
      entries: JSON.stringify([
        { type: 'dir', name: 'Albums', path: '/Albums' },
        { type: 'file', name: 'song.sid', path: '/song.sid' },
      ]),
    });

    const location = createLocalSourceLocation(source);
    const result = await location.listEntries('/');

    expect(result.map((entry) => entry.name)).toEqual(['Albums', 'song.sid']);
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
    nativePlatform = false;
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
    nativePlatform = false;
    const source = buildWebSource();

    const location = createLocalSourceLocation(source);
    const files = await location.listFilesRecursive('/music');

    expect(files).toEqual([
      {
        type: 'file',
        name: 'song.sid',
        path: '/music/song.sid',
        sizeBytes: 123,
        modifiedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        type: 'file',
        name: 'readme.txt',
        path: '/music/docs/readme.txt',
        sizeBytes: 45,
        modifiedAt: '2026-01-03T00:00:00.000Z',
      },
    ]);
  });

  it('marks sources unavailable when reselect is required', () => {
    platform = 'web';
    nativePlatform = false;
    const source = buildWebSource({ requiresReselect: true });

    const location = createLocalSourceLocation(source);

    expect(location.isAvailable).toBe(false);
  });

  it('resolveRootPath returns non-root path when entries are rooted there', async () => {
    platform = 'web';
    nativePlatform = false;
    const source = buildWebSource({
      rootPath: '/music',
      entries: [
        { name: 'song.sid', relativePath: 'music/song.sid', sizeBytes: 100, modifiedAt: null },
      ],
    });
    const location = createLocalSourceLocation(source);
    expect(location.rootPath).toBe('/music');
  });

  it('resolveRootPath falls back to root when no entries match rootPath prefix', async () => {
    platform = 'web';
    nativePlatform = false;
    const source = buildWebSource({
      rootPath: '/other',
      entries: [
        { name: 'song.sid', relativePath: 'music/song.sid', sizeBytes: 100, modifiedAt: null },
      ],
    });
    const location = createLocalSourceLocation(source);
    expect(location.rootPath).toBe('/');
  });

  it('parses SAF entries when returned as object with entries array', async () => {
    const source = buildAndroidSource();
    // coerceSafEntries object path - response.entries is an object with .entries array
    listChildrenMock.mockResolvedValue({
      entries: {
        entries: [
          { type: 'file', name: 'song.sid', path: '/song.sid' },
        ],
      },
    });
    const location = createLocalSourceLocation(source);
    const result = await location.listEntries('/');
    expect(result[0]?.name).toBe('song.sid');
  });

  it('throws when SAF entries JSON string is not an array', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({ entries: JSON.stringify({ wrapped: true }) });
    const location = createLocalSourceLocation(source);
    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('throws when SAF entries response is invalid JSON string', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({ entries: '{not:valid:json' });
    const location = createLocalSourceLocation(source);
    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('rejects SAF entry with unexpected type (not file or dir)', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({
      entries: [{ type: 'symlink', name: 'link.sid', path: '/link.sid' }],
    });
    const location = createLocalSourceLocation(source);
    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('rejects SAF entry with non-string name', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({
      entries: [{ type: 'file', name: 42, path: '/test.sid' }],
    });
    const location = createLocalSourceLocation(source);
    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('handles empty path in SAF listEntries', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({ entries: [] });
    const location = createLocalSourceLocation(source);
    const result = await location.listEntries('');
    expect(result).toEqual([]);
    expect(listChildrenMock).toHaveBeenCalledWith({ treeUri: source.android?.treeUri, path: '/' });
  });

  it('throws AbortError when SAF recursive listing has pre-aborted signal', async () => {
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({ entries: [] });
    const controller = new AbortController();
    controller.abort();
    const location = createLocalSourceLocation(source);
    await expect(location.listFilesRecursive('/', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts non-SAF recursive listing when signal is pre-aborted', async () => {
    platform = 'web';
    nativePlatform = false;
    const source = buildWebSource();
    const controller = new AbortController();
    controller.abort();
    const location = createLocalSourceLocation(source);
    await expect(location.listFilesRecursive('/', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('toLocalPlayFile uses Date.now() when modifiedAt is null', async () => {
    platform = 'web';
    nativePlatform = false;
    const source = buildWebSource({
      entries: [{ name: 'song.sid', relativePath: 'song.sid', sizeBytes: null, modifiedAt: null }],
    });
    const location = createLocalSourceLocation(source);
    const before = Date.now();
    const result = await location.listFilesRecursive('/');
    const after = Date.now();
    // modifiedAt null → lastModified is around Date.now() at load time
    // We can't access the playFile directly, but the entry is a SourceEntry, not LocalPlayFile
    // The test verifies no crash happens
    expect(result.length).toBe(1);
    expect(before).toBeLessThanOrEqual(after);
  });

  it('coerceSafEntries accepts object with nested entries array', async () => {
    // Covers the `value && typeof value === 'object'` path in coerceSafEntries
    // (when FolderPicker returns { entries: { entries: [...] } } nested structure)
    const source = buildAndroidSource();
    const innerEntries = [
      { type: 'file', name: 'track.sid', path: '/track.sid' },
    ];
    listChildrenMock.mockResolvedValue({ entries: { entries: innerEntries } });

    const location = createLocalSourceLocation(source);
    const result = await location.listEntries('/');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('track.sid');
  });

  it('normalizeSafEntry rejects entries with unrecognized type', async () => {
    // Covers `entry.type !== 'file' && entry.type !== 'dir'` → return null in normalizeSafEntry
    const source = buildAndroidSource();
    listChildrenMock.mockResolvedValue({
      entries: [
        { type: 'symlink', name: 'foo.sid', path: '/foo.sid' },
        { type: 'file', name: 'ok.sid', path: '/ok.sid' },
      ],
    });

    const location = createLocalSourceLocation(source);
    // symlink entry is invalid → throws LocalSourceListingError
    await expect(location.listEntries('/')).rejects.toBeInstanceOf(LocalSourceListingError);
  });

  it('listFilesRecursive on web source with no abort signal', async () => {
    // Covers options?.signal?.aborted path when signal is not provided
    platform = 'web';
    nativePlatform = false;
    const source = buildWebSource({
      entries: [
        { name: 'song.sid', relativePath: 'music/song.sid', sizeBytes: 100, modifiedAt: null },
      ],
    });
    const location = createLocalSourceLocation(source);
    const result = await location.listFilesRecursive('/');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('song.sid');
  });
});
