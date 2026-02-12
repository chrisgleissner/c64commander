/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import type { MediaIndexSnapshot, MediaIndexStorage } from '@/lib/media-index';
import { JsonMediaIndex } from '@/lib/media-index';
import type { HvscFolderListing } from '@/lib/hvsc/hvscTypes';
import { HvscMediaIndexAdapter } from '@/lib/hvsc/hvscMediaIndex';

const createMemoryStorage = (): MediaIndexStorage => {
  let current: MediaIndexSnapshot | null = null;
  return {
    read: async () => current,
    write: async (next) => {
      current = next;
    },
  };
};

describe('HvscMediaIndexAdapter', () => {
  it('scans folder listings and writes entries to the index', async () => {
    const listings: Record<string, HvscFolderListing> = {
      '/': { path: '/', folders: ['/Demos'], songs: [] },
      '/Demos': {
        path: '/Demos',
        folders: [],
        songs: [
          { id: 1, virtualPath: '/Demos/demo.sid', fileName: 'demo.sid', durationSeconds: 45 },
        ],
      },
    };

    const listFolder = async (path: string) => listings[path];
    const storage = createMemoryStorage();
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(storage), listFolder);

    await adapter.scan(['/']);

    const entry = adapter.queryByPath('/Demos/demo.sid');
    expect(entry?.name).toBe('demo.sid');
    expect(adapter.queryByType('sid')).toHaveLength(1);
  });

  it('normalizes paths and persists entries', async () => {
    const listings: Record<string, HvscFolderListing> = {
      '/': { path: '/', folders: ['/DEMOS'], songs: [] },
      '/DEMOS': {
        path: '/DEMOS',
        folders: ['/DEMOS/Nested'],
        songs: [],
      },
      '/DEMOS/Nested': {
        path: '/DEMOS/Nested',
        folders: [],
        songs: [
          { id: 2, virtualPath: '/DEMOS/Nested/track.sid', fileName: 'track.sid', durationSeconds: null },
        ],
      },
    };

    const listFolder = async (path: string) => listings[path];
    const storage = createMemoryStorage();
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(storage), listFolder);

    await adapter.scan(['DEMOS']);
    await adapter.save();

    const snapshot = await storage.read();
    expect(snapshot?.entries).toHaveLength(1);
    expect(adapter.getAll()).toHaveLength(1);
  });

  it('returns paged folder listings without rescanning full index per call', async () => {
    const listings: Record<string, HvscFolderListing> = {
      '/': {
        path: '/',
        folders: ['/DEMOS'],
        songs: [],
      },
      '/DEMOS': {
        path: '/DEMOS',
        folders: ['/DEMOS/A'],
        songs: [
          { id: 1, virtualPath: '/DEMOS/Alpha.sid', fileName: 'Alpha.sid', durationSeconds: 100 },
          { id: 2, virtualPath: '/DEMOS/Beta.sid', fileName: 'Beta.sid', durationSeconds: 120 },
        ],
      },
      '/DEMOS/A': {
        path: '/DEMOS/A',
        folders: [],
        songs: [
          { id: 3, virtualPath: '/DEMOS/A/Gamma.sid', fileName: 'Gamma.sid', durationSeconds: 140 },
        ],
      },
    };

    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async (path) => listings[path]);
    await adapter.scan(['/']);

    const page = adapter.queryFolderPage({ path: '/DEMOS', query: 'a', offset: 0, limit: 1 });

    expect(page.totalSongs).toBe(2);
    expect(page.songs).toHaveLength(1);
    expect(page.songs[0]?.fileName).toBe('Alpha.sid');
  });
});
