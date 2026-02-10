/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRamDumpFolderConfig,
  loadRamDumpFolderConfig,
  saveRamDumpFolderConfig,
} from '@/lib/config/ramDumpFolderStore';

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn(),
}));

describe('ramDumpFolderStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and loads folder config', () => {
    saveRamDumpFolderConfig({
      treeUri: 'content://folder',
      rootName: 'RAM',
      selectedAt: '2026-02-07T00:00:00.000Z',
    });

    expect(loadRamDumpFolderConfig()).toEqual({
      treeUri: 'content://folder',
      rootName: 'RAM',
      selectedAt: '2026-02-07T00:00:00.000Z',
      displayPath: 'RAM',
    });
  });

  it('returns null for invalid payload', () => {
    localStorage.setItem('c64u_ram_dump_folder:v1', JSON.stringify({ nope: true }));
    expect(loadRamDumpFolderConfig()).toBeNull();
  });

  it('clears folder config', () => {
    saveRamDumpFolderConfig({
      treeUri: 'content://folder',
      rootName: 'RAM',
      selectedAt: '2026-02-07T00:00:00.000Z',
    });
    clearRamDumpFolderConfig();
    expect(loadRamDumpFolderConfig()).toBeNull();
  });
});
