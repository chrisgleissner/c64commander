/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonMediaIndex, LocalStorageMediaIndexStorage } from '@/lib/media-index/localStorageMediaIndex';
import type { MediaIndexSnapshot } from '@/lib/media-index/mediaIndex';

const STORAGE_KEY = 'c64u_media_index:v1';

const buildSnapshot = (): MediaIndexSnapshot => ({
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  entries: [
    { path: '/music/song.sid', name: 'song.sid', type: 'sid', durationSeconds: 120 },
    { path: '/music/demo.prg', name: 'demo.prg', type: 'prg', sizeBytes: 2048 },
  ],
});

describe('localStorageMediaIndex', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when localStorage is unavailable', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });

    const storage = new LocalStorageMediaIndexStorage();
    await expect(storage.read()).resolves.toBeNull();
    await expect(storage.write(buildSnapshot())).resolves.toBeUndefined();

    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original);
    }
  });

  it('returns null for invalid JSON payloads', async () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const storage = new LocalStorageMediaIndexStorage();

    await expect(storage.read()).resolves.toBeNull();
  });

  it('writes snapshots to localStorage', async () => {
    const storage = new LocalStorageMediaIndexStorage();
    const snapshot = buildSnapshot();

    await storage.write(snapshot);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toContain('song.sid');
  });

  it('loads and queries entries by type and path', async () => {
    const snapshot = buildSnapshot();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    const storage = new LocalStorageMediaIndexStorage();
    const index = new JsonMediaIndex(storage);

    await index.load();

    expect(index.queryByType('sid')).toEqual([snapshot.entries[0]]);
    expect(index.queryByPath('/music/demo.prg')).toEqual(snapshot.entries[1]);
    expect(index.getAll()).toHaveLength(2);
  });

  it('scans by loading when not yet loaded', async () => {
    const snapshot = buildSnapshot();
    const storage = {
      read: vi.fn().mockResolvedValue(snapshot),
      write: vi.fn(),
    };
    const index = new JsonMediaIndex(storage);

    await index.scan(['/music']);

    expect(storage.read).toHaveBeenCalledTimes(1);
    expect(index.getAll()).toEqual(snapshot.entries);
  });

  it('saves snapshots using storage writer', async () => {
    const snapshot = buildSnapshot();
    const storage = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
    };
    const index = new JsonMediaIndex(storage);

    await index.load();
    index.setEntries(snapshot.entries);
    await index.save();

    expect(storage.write).toHaveBeenCalledTimes(1);
    const written = storage.write.mock.calls[0][0];
    expect(written.entries).toEqual(snapshot.entries);
    expect(typeof written.updatedAt).toBe('string');
  });
});
