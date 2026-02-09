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

const createMemoryStorage = (snapshot?: MediaIndexSnapshot | null): MediaIndexStorage => {
  let current = snapshot ?? null;
  return {
    read: async () => current,
    write: async (next) => {
      current = next;
    },
  };
};

describe('JsonMediaIndex', () => {
  it('loads entries from storage and queries by type/path', async () => {
    const snapshot: MediaIndexSnapshot = {
      version: 1,
      updatedAt: '2024-01-01T00:00:00.000Z',
      entries: [
        { path: '/HVSC/Demos/demo.sid', name: 'demo.sid', type: 'sid', durationSeconds: 30 },
        { path: '/HVSC/Disks/demo.d64', name: 'demo.d64', type: 'disk' },
      ],
    };
    const storage = createMemoryStorage(snapshot);
    const index = new JsonMediaIndex(storage);

    await index.load();

    expect(index.queryByPath('/HVSC/Demos/demo.sid')?.name).toBe('demo.sid');
    expect(index.queryByType('sid')).toHaveLength(1);
    expect(index.queryByType('disk')).toHaveLength(1);
  });

  it('saves entries to storage with updated timestamp', async () => {
    const storage = createMemoryStorage(null);
    const index = new JsonMediaIndex(storage);

    index.setEntries([
      { path: '/HVSC/Mods/demo.mod', name: 'demo.mod', type: 'mod', sizeBytes: 123 },
    ]);
    await index.save();

    const saved = await storage.read();
    expect(saved?.entries).toHaveLength(1);
    expect(saved?.entries[0].path).toBe('/HVSC/Mods/demo.mod');
    expect(saved?.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
