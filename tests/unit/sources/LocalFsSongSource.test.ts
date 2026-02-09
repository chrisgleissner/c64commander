/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
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
});
