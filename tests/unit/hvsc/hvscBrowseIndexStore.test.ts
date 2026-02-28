/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    stat: vi.fn(async () => ({ type: 'file', size: 1 })),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => { throw new Error('missing'); }),
    writeFile: vi.fn(async () => undefined),
  },
}));

import { Filesystem } from '@capacitor/filesystem';
import {
  buildHvscBrowseIndexFromEntries,
  getHvscFoldersWithParent,
  getHvscSongFromBrowseIndex,
  listFolderFromBrowseIndex,
  listHvscFolderTracks,
  verifyHvscBrowseIndexIntegrity,
} from '@/lib/hvsc/hvscBrowseIndexStore';

describe('hvscBrowseIndexStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds folder adjacency and lists children without full scan', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
      { path: '/DEMOS/B/Two.sid', name: 'Two.sid', type: 'sid' },
    ]);

    const root = listFolderFromBrowseIndex(snapshot, '/', '', 0, 50);
    expect(root.folders).toContain('/DEMOS');

    const demos = listFolderFromBrowseIndex(snapshot, '/DEMOS', '', 0, 50);
    expect(demos.folders).toContain('/DEMOS/A');
    expect(demos.folders).toContain('/DEMOS/B');
    expect(demos.totalSongs).toBe(0);

    const aFolder = listFolderFromBrowseIndex(snapshot, '/DEMOS/A', '', 0, 50);
    expect(aFolder.totalSongs).toBe(1);
    expect(aFolder.songs[0]?.fileName).toBe('One.sid');
  });

  it('reports integrity failures when sampled files are missing', async () => {
    vi.mocked(Filesystem.stat).mockRejectedValueOnce(new Error('missing'));

    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
      { path: '/DEMOS/B/Two.sid', name: 'Two.sid', type: 'sid' },
    ]);

    const result = await verifyHvscBrowseIndexIntegrity(snapshot, 2);
    expect(result.isValid).toBe(false);
    expect(result.missingPaths.length).toBeGreaterThan(0);
  });

  it('returns valid for empty index in integrity check', async () => {
    const snapshot = buildHvscBrowseIndexFromEntries([]);
    const result = await verifyHvscBrowseIndexIntegrity(snapshot);
    expect(result.isValid).toBe(true);
    expect(result.sampled).toBe(0);
    expect(result.missingPaths).toEqual([]);
  });

  it('gets song from browse index by path', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
    ]);
    const song = getHvscSongFromBrowseIndex(snapshot, '/DEMOS/A/One.sid');
    expect(song).not.toBeNull();
    expect(song?.fileName).toBe('One.sid');
  });

  it('returns null for missing song in browse index', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
    ]);
    const song = getHvscSongFromBrowseIndex(snapshot, '/nonexist/Song.sid');
    expect(song).toBeNull();
  });

  it('gets folders with parent', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
      { path: '/DEMOS/B/Two.sid', name: 'Two.sid', type: 'sid' },
    ]);
    const folders = getHvscFoldersWithParent(snapshot, '/DEMOS');
    expect(folders.length).toBe(2);
    expect(folders.map((f) => f.folderName).sort()).toEqual(['A', 'B']);
  });

  it('returns empty array for non-existent parent folder', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
    ]);
    const folders = getHvscFoldersWithParent(snapshot, '/NONEXIST');
    expect(folders).toEqual([]);
  });

  it('lists folder tracks', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
      { path: '/DEMOS/A/Two.sid', name: 'Two.sid', type: 'sid' },
    ]);
    const tracks = listHvscFolderTracks(snapshot, '/DEMOS/A');
    expect(tracks.length).toBe(2);
    expect(tracks.map((t) => t.fileName).sort()).toEqual(['One.sid', 'Two.sid']);
  });

  it('returns empty array for non-existent folder tracks', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([]);
    const tracks = listHvscFolderTracks(snapshot, '/NONEXIST');
    expect(tracks).toEqual([]);
  });

  it('filters songs by query in listFolderFromBrowseIndex', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/Alpha.sid', name: 'Alpha.sid', type: 'sid' },
      { path: '/DEMOS/A/Beta.sid', name: 'Beta.sid', type: 'sid' },
    ]);
    const result = listFolderFromBrowseIndex(snapshot, '/DEMOS/A', 'alpha', 0, 50);
    expect(result.totalSongs).toBe(1);
    expect(result.songs[0]?.fileName).toBe('Alpha.sid');
  });

  it('normalizes trailing-slash folder path', () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: '/DEMOS/A/One.sid', name: 'One.sid', type: 'sid' },
    ]);
    const result = listFolderFromBrowseIndex(snapshot, '/DEMOS/A/', '', 0, 50);
    expect(result.totalSongs).toBe(1);
  });

  it('loads snapshot from localStorage when filesystem fails', async () => {
    const { loadHvscBrowseIndexSnapshot, saveHvscBrowseIndexSnapshot, buildHvscBrowseIndexFromEntries: build } = await import('@/lib/hvsc/hvscBrowseIndexStore');
    const snapshot = build([
      { path: '/test.sid', name: 'test.sid', type: 'sid' },
    ]);

    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }

    // Force localStorage fallback on save
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error('disk full') as any);
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
    await saveHvscBrowseIndexSnapshot(snapshot);

    // Filesystem read fails, should fall back to localStorage
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('missing'));
    const loaded = await loadHvscBrowseIndexSnapshot();
    expect(loaded).toEqual(snapshot);
  });

  it('clears browse index from storage', async () => {
    const { clearHvscBrowseIndexSnapshot } = await import('@/lib/hvsc/hvscBrowseIndexStore');
    vi.mocked(Filesystem.deleteFile ?? vi.fn()).mockResolvedValue(undefined as any);
    const deleteFileFn = (Filesystem as any).deleteFile;
    if (!deleteFileFn) {
      (Filesystem as any).deleteFile = vi.fn(async () => undefined);
    }
    await clearHvscBrowseIndexSnapshot();
  });

  it('creates empty snapshot with correct schema', async () => {
    const { createEmptyHvscBrowseIndexSnapshot } = await import('@/lib/hvsc/hvscBrowseIndexStore');
    const empty = createEmptyHvscBrowseIndexSnapshot();
    expect(empty.schemaVersion).toBe(1);
    expect(empty.folders['/']).toBeDefined();
    expect(Object.keys(empty.songs)).toHaveLength(0);
  });

  it('creates mutable browse index for baseline', async () => {
    const { createHvscBrowseIndexMutable } = await import('@/lib/hvsc/hvscBrowseIndexStore');
    vi.mocked(Filesystem.writeFile).mockResolvedValue(undefined as any);
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);

    const mutable = await createHvscBrowseIndexMutable('baseline');
    mutable.upsertSong({
      virtualPath: '/DEMOS/test.sid',
      fileName: 'test.sid',
      durationSeconds: 42,
    });
    mutable.deleteSong('/nonexistent.sid');
    await mutable.finalize();
  });

  it('verifies integrity of empty snapshot', async () => {
    const { createEmptyHvscBrowseIndexSnapshot, verifyHvscBrowseIndexIntegrity: verify } = await import('@/lib/hvsc/hvscBrowseIndexStore');
    const empty = createEmptyHvscBrowseIndexSnapshot();
    const result = await verify(empty);
    expect(result.isValid).toBe(true);
  });
});
