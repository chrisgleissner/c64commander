/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import type { FileLibraryEntry } from '@/lib/playback/fileLibraryTypes';
import { buildFileLibraryId, resolvePlayRequestFromLibrary } from '@/lib/playback/fileLibraryUtils';

describe('file library utilities', () => {
  it('builds stable library ids', () => {
    const id = buildFileLibraryId('local', '/Music/demo.sid', 'local-1');
    expect(id).toBe('local-1:/Music/demo.sid');
  });

  it('resolves ultimate play requests without file data', () => {
    const entry: FileLibraryEntry = {
      id: 'ultimate:/Usb0/demo.sid',
      source: 'ultimate',
      name: 'demo.sid',
      path: '/Usb0/demo.sid',
      category: 'sid',
      addedAt: new Date().toISOString(),
    };
    const request = resolvePlayRequestFromLibrary(entry, {});
    expect(request.source).toBe('ultimate');
    expect(request.path).toBe('/Usb0/demo.sid');
    expect(request.file).toBeUndefined();
  });

  it('resolves local play requests from runtime files', () => {
    const entry: FileLibraryEntry = {
      id: 'local:/Music/demo.sid',
      source: 'local',
      name: 'demo.sid',
      path: '/Music/demo.sid',
      category: 'sid',
      addedAt: new Date().toISOString(),
    };
    const runtime = {
      [entry.id]: {
        name: 'demo.sid',
        webkitRelativePath: 'Music/demo.sid',
        lastModified: Date.now(),
        arrayBuffer: async () => new ArrayBuffer(0),
      },
    };
    const request = resolvePlayRequestFromLibrary(entry, runtime);
    expect(request.source).toBe('local');
    expect(request.file).toBeDefined();
  });
});