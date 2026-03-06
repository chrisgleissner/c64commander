/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalFsSongSource, type LocalSidFile } from '@/lib/sources/LocalFsSongSource';

const sidUtilsMocks = vi.hoisted(() => ({
  computeSidMd5: vi.fn(async () => 'sid-md5'),
  getSidSongCount: vi.fn(() => 1),
}));

vi.mock('@/lib/sid/sidUtils', () => ({
  computeSidMd5: sidUtilsMocks.computeSidMd5,
  getSidSongCount: sidUtilsMocks.getSidSongCount,
}));

const toBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const createPsidPayload = (songCount: number, totalBytes = 0x80) => {
  const bytes = new Uint8Array(totalBytes);
  bytes.set([0x50, 0x53, 0x49, 0x44], 0);
  bytes[14] = (songCount >> 8) & 0xff;
  bytes[15] = songCount & 0xff;
  return bytes;
};

const createLocalFile = (path: string, name: string, payload: Uint8Array): LocalSidFile => ({
  name,
  webkitRelativePath: path.replace(/^\//, ''),
  lastModified: 1,
  arrayBuffer: vi.fn(async () => toBuffer(payload)),
  slice: vi.fn((start: number, end: number) => ({
    arrayBuffer: vi.fn(async () => toBuffer(payload.slice(start, end))),
  })),
} as unknown as LocalSidFile);

const waitForCondition = async (predicate: () => boolean, timeoutMs = 2_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('createLocalFsSongSource', () => {
  beforeEach(() => {
    sidUtilsMocks.computeSidMd5.mockReset();
    sidUtilsMocks.computeSidMd5.mockResolvedValue('sid-md5');
    sidUtilsMocks.getSidSongCount.mockReset();
    sidUtilsMocks.getSidSongCount.mockReturnValue(1);
  });

  it('returns quickly, then enriches songs in the background and notifies UI', async () => {
    sidUtilsMocks.getSidSongCount.mockReturnValue(3);
    const file = createLocalFile('/MUSIC/TUNE.sid', 'TUNE.sid', createPsidPayload(3));
    const onSongMetadataResolved = vi.fn();
    const resolveSonglength = vi.fn(async () => ({
      strategy: 'filename-unique' as const,
      durationSeconds: 120,
      durations: [120, 240],
    }));
    const source = createLocalFsSongSource([file], {
      resolveSonglength,
      onSongMetadataResolved,
    });

    const firstPass = await source.listSongs('/MUSIC');
    expect(firstPass).toHaveLength(1);
    expect(firstPass[0].subsongCount).toBe(1);
    expect(firstPass[0].durationMs).toBeUndefined();

    await waitForCondition(() => onSongMetadataResolved.mock.calls.length > 0);
    const update = onSongMetadataResolved.mock.calls[0][0] as { entries: Array<{ subsongCount?: number; durationMs?: number }> };
    expect(update.entries).toHaveLength(3);
    expect(update.entries[0].durationMs).toBe(120_000);
    expect(update.entries[1].durationMs).toBe(240_000);
    expect(update.entries[2].durationMs).toBeUndefined();
    expect(update.entries[0].subsongCount).toBe(3);
    expect(resolveSonglength).toHaveBeenCalledTimes(1);

    const secondPass = await source.listSongs('/MUSIC');
    expect(secondPass).toHaveLength(3);
    expect(secondPass[0].subsongCount).toBe(3);
    expect(secondPass[0].durationMs).toBe(120_000);
  });

  it('falls back to md5 lookup only when filename/path lookup is unresolved', async () => {
    const file = createLocalFile('/A/TUNE.sid', 'TUNE.sid', createPsidPayload(1));
    const onSongMetadataResolved = vi.fn();
    const resolveSonglength = vi.fn()
      .mockResolvedValueOnce({
        strategy: 'not-found' as const,
        durationSeconds: null,
      })
      .mockResolvedValueOnce({
        strategy: 'md5' as const,
        durationSeconds: 111,
        durations: [111],
      });

    const source = createLocalFsSongSource([file], {
      resolveSonglength,
      onSongMetadataResolved,
    });

    await source.listSongs('/A');
    await waitForCondition(() => onSongMetadataResolved.mock.calls.length > 0);

    expect(resolveSonglength).toHaveBeenCalledTimes(2);
    expect(resolveSonglength.mock.calls[0][0]).toMatchObject({
      fileName: 'TUNE.sid',
      partialPath: '/A',
      virtualPath: '/A/TUNE.sid',
    });
    expect(resolveSonglength.mock.calls[1][0]).toMatchObject({
      fileName: 'TUNE.sid',
      partialPath: '/A',
      virtualPath: '/A/TUNE.sid',
      md5: 'sid-md5',
    });

    const secondPass = await source.listSongs('/A');
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0].durationMs).toBe(111_000);
    expect(sidUtilsMocks.computeSidMd5).toHaveBeenCalledTimes(1);
  });

  it('handles fallback when File.slice is missing', async () => {
    const payload = createPsidPayload(1);
    const file = {
      name: 'noslice.sid',
      lastModified: 1000,
      arrayBuffer: async () => payload.buffer.slice(0), // Full buffer
      // no slice method
    } as LocalSidFile;

    const source = createLocalFsSongSource([file], {});
    const list = await source.listSongs('/');
    expect(list).toHaveLength(1);

    // Trigger enrichment check
    await new Promise(r => setTimeout(r, 10));
    expect(sidUtilsMocks.getSidSongCount).toHaveBeenCalled();
  });

  it('correctly handles multi-song files with missing durations', async () => {
    sidUtilsMocks.getSidSongCount.mockReturnValue(2);
    const file = createLocalFile('/demo.sid', 'demo.sid', createPsidPayload(2));
    const onResolved = vi.fn();

    const resolveSonglength = vi.fn(async () => Promise.resolve({
      strategy: 'default' as const,
      durationSeconds: null,
      durations: null, // No durations
    }));

    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, resolveSonglength });
    await source.listSongs('/');

    await waitForCondition(() => onResolved.mock.calls.length > 0);
    const entries = onResolved.mock.calls[0][0].entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].durationMs).toBeUndefined();
    expect(entries[1].durationMs).toBeUndefined();
  });

  it('handling of files at root path vs nested', async () => {
    const rootFile = createLocalFile('/root.sid', 'root.sid', createPsidPayload(1));
    const nestedFile = createLocalFile('/folder/nested.sid', 'nested.sid', createPsidPayload(1));

    const source = createLocalFsSongSource([rootFile, nestedFile], {});

    const rootList = await source.listSongs('/');
    expect(rootList.some(e => e.title === 'root.sid')).toBe(true);

    const folderList = await source.listSongs('/folder');
    expect(folderList.some(e => e.title === 'nested.sid')).toBe(true);
  });

  it('handles durations array mismatch and single duration fallback', async () => {
    sidUtilsMocks.getSidSongCount.mockReturnValue(2);
    const file = createLocalFile('/short.sid', 'short.sid', createPsidPayload(2));
    const onResolved = vi.fn();

    // Case 1: durations array shorter than song count
    const resolveSonglength = vi.fn()
      .mockResolvedValueOnce({
        strategy: 'default' as const,
        durations: [10], // Only 1 duration for 2 songs
      });

    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, resolveSonglength });
    await source.listSongs('/');
    await waitForCondition(() => onResolved.mock.calls.length > 0);

    const entries = onResolved.mock.calls[0][0].entries;
    expect(entries[0].durationMs).toBe(10000);
    expect(entries[1].durationMs).toBeUndefined();
  });

  it('uses durationSeconds if durations array is missing', async () => {
    sidUtilsMocks.getSidSongCount.mockReturnValue(1);
    const file = createLocalFile('/single.sid', 'single.sid', createPsidPayload(1));
    const onResolved = vi.fn();

    const resolveSonglength = vi.fn().mockResolvedValueOnce({
      strategy: 'default' as const,
      durationSeconds: 50,
      durations: [], // Empty
    });

    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, resolveSonglength });
    await source.listSongs('/');
    await waitForCondition(() => onResolved.mock.calls.length > 0);

    const entries = onResolved.mock.calls[0][0].entries;
    expect(entries[0].durationMs).toBe(50000);
  });

  it('does not re-compute MD5 if strategy is unavailable', async () => {
    const file = createLocalFile('/ignore.sid', 'ignore.sid', createPsidPayload(1));
    const onResolved = vi.fn();

    const resolveSonglength = vi.fn().mockResolvedValue({
      strategy: 'unavailable' as const,
      durationSeconds: null,
    });

    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, resolveSonglength });
    await source.listSongs('/');
    await waitForCondition(() => onResolved.mock.calls.length > 0);

    expect(sidUtilsMocks.computeSidMd5).not.toHaveBeenCalled();
  });

  it('uses lookupDurationsByMd5Seconds option for duration resolution', async () => {
    const file = createLocalFile('/md5multi.sid', 'md5multi.sid', createPsidPayload(2));
    sidUtilsMocks.getSidSongCount.mockReturnValue(2);
    const onResolved = vi.fn();

    const lookupDurationsByMd5Seconds = vi.fn().mockResolvedValue([30, 45]);
    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, lookupDurationsByMd5Seconds });
    await source.listSongs('/');
    await waitForCondition(() => onResolved.mock.calls.length > 0);

    const entries = onResolved.mock.calls[0][0].entries;
    expect(entries[0].durationMs).toBe(30000);
    expect(entries[1].durationMs).toBe(45000);
  });

  it('uses lookupDurationSeconds option for single-duration resolution', async () => {
    const file = createLocalFile('/single-md5.sid', 'single-md5.sid', createPsidPayload(1));
    const onResolved = vi.fn();

    const lookupDurationSeconds = vi.fn().mockResolvedValue(25);
    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, lookupDurationSeconds });
    await source.listSongs('/');
    await waitForCondition(() => onResolved.mock.calls.length > 0);

    const entries = onResolved.mock.calls[0][0].entries;
    expect(entries[0].durationMs).toBe(25000);
  });

  it('handles null lookupDurationSeconds result', async () => {
    const file = createLocalFile('/null-dur.sid', 'null-dur.sid', createPsidPayload(1));
    const onResolved = vi.fn();

    const lookupDurationSeconds = vi.fn().mockResolvedValue(null);
    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, lookupDurationSeconds });
    await source.listSongs('/');
    await waitForCondition(() => onResolved.mock.calls.length > 0);

    const entries = onResolved.mock.calls[0][0].entries;
    expect(entries[0].durationMs).toBeUndefined();
  });

  it('handles duration lookup throwing (catch branch)', async () => {
    const file = createLocalFile('/error-dur.sid', 'error-dur.sid', createPsidPayload(1));
    const onResolved = vi.fn();

    const resolveSonglength = vi.fn().mockRejectedValue(new Error('lookup error'));
    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved, resolveSonglength });
    await source.listSongs('/');
    await waitForCondition(() => onResolved.mock.calls.length > 0);

    // Error is caught, entries still returned with no duration
    const entries = onResolved.mock.calls[0][0].entries;
    expect(entries[0].durationMs).toBeUndefined();
  });

  it('handles metadata scan error when arrayBuffer throws', async () => {
    const file: LocalSidFile = {
      name: 'broken.sid',
      lastModified: 1,
      arrayBuffer: vi.fn().mockRejectedValue(new Error('read error')),
      // no slice - forces arrayBuffer usage
    } as unknown as LocalSidFile;

    const onResolved = vi.fn();
    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved });

    // Even though background scan fails, listSongs should still work
    const list = await source.listSongs('/');
    expect(list).toHaveLength(1);
    // Wait a bit for the error to be processed
    await new Promise(r => setTimeout(r, 50));
    // onResolved is not called because the scan failed, but no crash
    expect(list[0].title).toBe('broken.sid');
  });

  it('handles small file buffer without slicing (readSidHeader fallback)', async () => {
    const smallPayload = new Uint8Array(10); // < 0x20 bytes
    const file: LocalSidFile = {
      name: 'tiny.sid',
      lastModified: 1,
      arrayBuffer: async () => smallPayload.buffer,
      // no slice
    } as unknown as LocalSidFile;

    const onResolved = vi.fn();
    const source = createLocalFsSongSource([file], { onSongMetadataResolved: onResolved });
    await source.listSongs('/');
    await new Promise(r => setTimeout(r, 20));
    expect(sidUtilsMocks.getSidSongCount).toHaveBeenCalled();
  });

  it('lists songs with empty path (normalizes to root)', async () => {
    const file = createLocalFile('/music/demo.sid', 'demo.sid', createPsidPayload(1));
    const source = createLocalFsSongSource([file], {});
    const result = await source.listSongs('');
    expect(result.length).toBeGreaterThan(0);
  });

  it('builds entries with null lastModified', async () => {
    const file: LocalSidFile = {
      name: 'nomod.sid',
      lastModified: undefined as unknown as number,
      arrayBuffer: async () => createPsidPayload(1).buffer,
      slice: undefined as unknown as File['slice'],
    } as unknown as LocalSidFile;

    const source = createLocalFsSongSource([file], {});
    const list = await source.listSongs('/');
    expect(list[0].id).toContain('0'); // lastModified ?? 0
  });

  it('sorts songs with undefined songNr (treats as 1)', async () => {
    const file1 = createLocalFile('/a.sid', 'a.sid', createPsidPayload(1));
    const file2 = createLocalFile('/b.sid', 'b.sid', createPsidPayload(1));
    const source = createLocalFsSongSource([file1, file2], {});
    const list = await source.listSongs('/');
    // Both should be in the list sorted properly
    expect(list.length).toBe(2);
    expect(list[0].path).toBe('/a.sid');
    expect(list[1].path).toBe('/b.sid');
  });

  it('lists unique, sorted folders and supports folder-path filtering', async () => {
    const fileA = createLocalFile('/music/demo/a.sid', 'a.sid', createPsidPayload(1));
    const fileB = createLocalFile('/music/demo/b.sid', 'b.sid', createPsidPayload(1));
    const fileC = createLocalFile('/music/other/c.sid', 'c.sid', createPsidPayload(1));
    const fileRoot = createLocalFile('/root.sid', 'root.sid', createPsidPayload(1));
    const source = createLocalFsSongSource([fileA, fileB, fileC, fileRoot], {});

    const allFolders = await source.listFolders('/');
    expect(allFolders.map((entry) => entry.path)).toEqual(['/music/demo', '/music/other']);

    const filtered = await source.listFolders('/music/demo');
    expect(filtered.map((entry) => entry.path)).toEqual(['/music/demo']);
  });

  it('throws when getSong entry has no local payload', async () => {
    const file = createLocalFile('/a.sid', 'a.sid', createPsidPayload(1));
    const source = createLocalFsSongSource([file], {});

    await expect(source.getSong({
      id: 'x',
      path: '/a.sid',
      title: 'a.sid',
      source: 'local',
    })).rejects.toThrow('Missing local file data.');
  });

  it('resolves getSong duration by songNr from md5 lookup when entry has no duration', async () => {
    const payload = createPsidPayload(3);
    const file = createLocalFile('/set.sid', 'set.sid', payload);
    const source = createLocalFsSongSource([file], {
      lookupDurationsByMd5Seconds: vi.fn().mockResolvedValue([10, 20, 30]),
    });

    const song = await source.getSong({
      id: 'set:2',
      path: '/set.sid',
      title: 'set.sid (Song 2/3)',
      source: 'local',
      songNr: 2,
      payload: file,
    });

    expect(song.durationMs).toBe(20_000);
    expect(song.path).toBe('/set.sid');
    expect(song.title).toContain('Song 2/3');
  });
});
