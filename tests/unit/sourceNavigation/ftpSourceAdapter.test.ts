/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ftp/ftpClient', () => ({
  listFtpDirectory: vi.fn(),
}));

vi.mock('@/lib/ftp/ftpConfig', () => ({
  getStoredFtpPort: vi.fn(() => 21),
}));

vi.mock('@/lib/secureStorage', () => ({
  getPassword: vi.fn(async () => 'secret'),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => true),
  getCachedPassword: vi.fn(() => 'secret'),
}));

import { listFtpDirectory } from '@/lib/ftp/ftpClient';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';

const listFtpDirectoryMock = vi.mocked(listFtpDirectory);

describe('ftpSourceAdapter', () => {
  beforeEach(() => {
    listFtpDirectoryMock.mockReset();
    localStorage.clear();
    localStorage.setItem('c64u_device_host', 'c64u');
    localStorage.setItem('c64u_has_password', '1');
  });

  it('caches directory listings and reuses cache', async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        { type: 'file', name: 'track.sid', path: '/track.sid', size: 123, modifiedAt: 'now' },
      ],
    });

    const source = createUltimateSourceLocation();
    const first = await source.listEntries('/');
    const second = await source.listEntries('/');

    expect(first).toEqual(second);
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it('clears cache for path and refetches', async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        { type: 'file', name: 'track.sid', path: '/track.sid', size: 123, modifiedAt: 'now' },
      ],
    });

    const source = createUltimateSourceLocation();
    await source.listEntries('/');
    source.clearCacheForPath('/');
    await source.listEntries('/');

    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it('recursively lists files across directories', async () => {
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === '/') {
        return {
          entries: [
            { type: 'dir', name: 'music', path: '/music' },
            { type: 'file', name: 'root.sid', path: '/root.sid', size: 5, modifiedAt: 'now' },
          ],
        };
      }
      if (path === '/music') {
        return {
          entries: [
            { type: 'file', name: 'song.sid', path: '/music/song.sid', size: 10, modifiedAt: 'now' },
          ],
        };
      }
      return { entries: [] };
    });

    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive('/');

    expect(results.map((entry) => entry.path).sort()).toEqual(['/music/song.sid', '/root.sid']);
  });

  it('cancels recursive listing and stops further FTP calls', async () => {
    const controller = new AbortController();
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === '/') {
        controller.abort();
        return {
          entries: [
            { type: 'dir', name: 'music', path: '/music' },
            { type: 'file', name: 'root.sid', path: '/root.sid', size: 5, modifiedAt: 'now' },
          ],
        };
      }
      return {
        entries: [
          { type: 'file', name: 'song.sid', path: '/music/song.sid', size: 10, modifiedAt: 'now' },
        ],
      };
    });

    const source = createUltimateSourceLocation();
    await expect(source.listFilesRecursive('/', { signal: controller.signal })).rejects.toThrow(/Aborted/);
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(1);
  });
});
