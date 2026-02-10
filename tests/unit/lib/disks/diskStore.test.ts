/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadDiskLibrary, saveDiskLibrary } from '@/lib/disks/diskStore';
import { createDiskEntry } from '@/lib/disks/diskTypes';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('diskStore', () => {
    const mockId = 'test-library';
    const mockDisk = createDiskEntry({ path: '/disk.d64', location: 'local' });

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('returns empty disks if nothing stored', () => {
        const loaded = loadDiskLibrary(mockId);
        expect(loaded.disks).toEqual([]);
    });

    it('saves and loads library', () => {
        const state = { disks: [mockDisk] };
        saveDiskLibrary(mockId, state);

        const loaded = loadDiskLibrary(mockId);
        expect(loaded.disks).toHaveLength(1);
        expect(loaded.disks[0].id).toBe(mockDisk.id);
    });

    it('handles invalid JSON gracefully', () => {
        localStorage.setItem(`c64u_disk_library:${mockId}`, 'invalid json');
        const loaded = loadDiskLibrary(mockId);
        expect(loaded.disks).toEqual([]);
    });

    it('handles valid JSON with invalid structure gracefully', () => {
        localStorage.setItem(`c64u_disk_library:${mockId}`, JSON.stringify({ disks: "not an array" }));
        const loaded = loadDiskLibrary(mockId);
        expect(loaded.disks).toEqual([]);
    });
});
