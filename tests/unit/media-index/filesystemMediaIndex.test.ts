/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mkdirMock = vi.fn();
const readFileMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    mkdir: (...args: unknown[]) => mkdirMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  },
}));

import { FilesystemMediaIndexStorage } from '@/lib/media-index/filesystemMediaIndex';
import type { MediaIndexSnapshot } from '@/lib/media-index/mediaIndex';

const makeSnapshot = (): MediaIndexSnapshot => ({
  version: 1,
  updatedAt: '2026-03-03T00:00:00.000Z',
  entries: [{ path: '/DEMOS/song.sid', name: 'song.sid', type: 'sid' }],
});

describe('FilesystemMediaIndexStorage', () => {
  beforeEach(() => {
    mkdirMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('read()', () => {
    it('returns null when Filesystem.readFile throws', async () => {
      readFileMock.mockRejectedValue(new Error('file not found'));
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();
      expect(result).toBeNull();
    });

    it('returns null when stored data is empty (covers safeParse !raw branch)', async () => {
      // data = '' → decodeUtf8Base64('') = '' → safeParse('') → !'' = true → null
      readFileMock.mockResolvedValue({ data: '' });
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();
      expect(result).toBeNull();
    });

    it('returns null when stored data is invalid JSON', async () => {
      // Encode invalid JSON so safeParse catches the parse error
      const invalid = btoa(unescape(encodeURIComponent('{bad json')));
      readFileMock.mockResolvedValue({ data: invalid });
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();
      expect(result).toBeNull();
    });

    it('round-trips a valid snapshot through write and read', async () => {
      const snapshot = makeSnapshot();
      const storage = new FilesystemMediaIndexStorage();

      // Capture data written by write()
      let capturedData = '';
      writeFileMock.mockImplementation(async (args: { data: string }) => {
        capturedData = args.data;
      });

      await storage.write(snapshot);
      expect(mkdirMock).toHaveBeenCalledOnce();
      expect(writeFileMock).toHaveBeenCalledOnce();

      // Return captured data from subsequent read
      readFileMock.mockResolvedValue({ data: capturedData });
      const readback = await storage.read();
      expect(readback).toEqual(snapshot);
    });

    it('uses Buffer fallback for decoding when atob is unavailable', async () => {
      // Covers the typeof atob !== 'function' branch in decodeUtf8Base64
      const snapshot = makeSnapshot();
      const json = JSON.stringify(snapshot);
      const base64 = Buffer.from(json, 'utf-8').toString('base64');
      readFileMock.mockResolvedValue({ data: base64 });

      const originalAtob = globalThis.atob;
      (globalThis as any).atob = undefined;
      try {
        const storage = new FilesystemMediaIndexStorage();
        const result = await storage.read();
        expect(result).toEqual(snapshot);
      } finally {
        (globalThis as any).atob = originalAtob;
      }
    });

    it('uses Buffer fallback for encoding when btoa is unavailable', async () => {
      // Covers the typeof btoa !== 'function' branch in encodeUtf8Base64
      const snapshot = makeSnapshot();
      const storage = new FilesystemMediaIndexStorage();

      let capturedData = '';
      writeFileMock.mockImplementation(async (args: { data: string }) => {
        capturedData = args.data;
      });

      const originalBtoa = globalThis.btoa;
      (globalThis as any).btoa = undefined;
      try {
        await storage.write(snapshot);
      } finally {
        (globalThis as any).btoa = originalBtoa;
      }

      // capturedData should be valid base64 produced by Buffer.from
      const decoded = Buffer.from(capturedData, 'base64').toString('utf-8');
      expect(JSON.parse(decoded)).toEqual(snapshot);
    });
  });
});
