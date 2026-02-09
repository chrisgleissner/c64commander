/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { listLocalFiles } from '@/lib/playback/localFileBrowser';

describe('localFileBrowser', () => {
  it('includes size and modified timestamp for listed files', () => {
    const file = new File(['data'], 'song.sid', { lastModified: 123456 });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Music/song.sid' });

    const results = listLocalFiles([file], '/Music/');
    expect(results[0]?.sizeBytes).toBe(file.size);
    expect(results[0]?.modifiedAt).toBe(new Date(123456).toISOString());
  });
});