/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
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
  listFolderFromBrowseIndex,
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
});
