/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { deriveRamDumpFolderDisplayPath } from './ramDumpFolderStore';

describe('deriveRamDumpFolderDisplayPath', () => {
    it('formats primary storage paths without SAF prefixes', () => {
        const uri = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fc64';
        expect(deriveRamDumpFolderDisplayPath(uri)).toBe('Internal storage/Download/c64');
    });

    it('formats non-primary volumes with label', () => {
        const uri = 'content://com.android.externalstorage.documents/tree/1234-5678%3AMusic%2FHVSC';
        expect(deriveRamDumpFolderDisplayPath(uri)).toBe('1234-5678/Music/HVSC');
    });

    it('falls back to root name when tree id is missing', () => {
        const uri = 'content://com.android.externalstorage.documents/unknown';
        expect(deriveRamDumpFolderDisplayPath(uri, 'HVSC')).toBe('HVSC');
    });
});
