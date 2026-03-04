/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSonglengthsSearchPaths,
  collectSonglengthsSearchPaths,
  DOCUMENTS_FOLDER,
  isSonglengthsFileName,
  SONGLENGTHS_FILE_NAMES,
} from '@/lib/sid/songlengthsDiscovery';

const normalize = (paths: string[]) => paths.map((path) => path.replace(/\\/g, '/'));

describe('songlengthsDiscovery', () => {
  describe('isSonglengthsFileName', () => {
    it('accepts recognised file names case-insensitively', () => {
      expect(isSonglengthsFileName('songlengths.md5')).toBe(true);
      expect(isSonglengthsFileName('SONGLENGTHS.MD5')).toBe(true);
      expect(isSonglengthsFileName('songlengths.txt')).toBe(true);
      expect(isSonglengthsFileName('  SONGLENGTHS.TXT  ')).toBe(true);
    });

    it('rejects non-songlengths file names', () => {
      expect(isSonglengthsFileName('songlengths.json')).toBe(false);
      expect(isSonglengthsFileName('other.md5')).toBe(false);
      expect(isSonglengthsFileName('')).toBe(false);
    });
  });

  describe('buildSonglengthsSearchPaths', () => {
    it('builds upward and DOCUMENTS search paths', () => {
      const paths = buildSonglengthsSearchPaths('/Music/DEMOS/demo.sid');
      const normalized = normalize(paths);
      SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
        expect(normalized).toContain(`/Music/DEMOS/${fileName}`);
        expect(normalized).toContain(`/Music/DEMOS/${DOCUMENTS_FOLDER}/${fileName}`);
        expect(normalized).toContain(`/Music/${fileName}`);
        expect(normalized).toContain(`/Music/${DOCUMENTS_FOLDER}/${fileName}`);
        expect(normalized).toContain(`/${fileName}`);
        expect(normalized).toContain(`/${DOCUMENTS_FOLDER}/${fileName}`);
      });
    });

    it('handles path without leading slash', () => {
      const paths = buildSonglengthsSearchPaths('Music/demo.sid');
      const normalized = normalize(paths);
      SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
        expect(normalized).toContain(`/Music/${fileName}`);
        expect(normalized).toContain(`/${fileName}`);
      });
    });

    it('handles directory path ending with slash', () => {
      const paths = buildSonglengthsSearchPaths('/Music/DEMOS/');
      const normalized = normalize(paths);
      SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
        expect(normalized).toContain(`/Music/DEMOS/${fileName}`);
        expect(normalized).toContain(`/Music/${fileName}`);
        expect(normalized).toContain(`/${fileName}`);
      });
    });

    it('handles empty path as root and returns root-level search paths', () => {
      const paths = buildSonglengthsSearchPaths('');
      const normalized = normalize(paths);
      SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
        expect(normalized).toContain(`/${fileName}`);
        expect(normalized).toContain(`/${DOCUMENTS_FOLDER}/${fileName}`);
      });
      expect(paths.length).toBe(SONGLENGTHS_FILE_NAMES.length * 2);
    });
  });

  describe('collectSonglengthsSearchPaths', () => {
    it('collects unique normalized paths across inputs', () => {
      const paths = collectSonglengthsSearchPaths([
        '/Music/DEMOS/demo.sid',
        '/Music/DEMOS/demo2.sid',
      ]);
      SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
        const matches = paths.filter((path) => path.endsWith(`/${fileName}`));
        const unique = new Set(matches);
        expect(unique.size).toBeGreaterThan(0);
        expect(unique.size).toBe(matches.length);
      });
    });

    it('returns empty array for empty input', () => {
      expect(collectSonglengthsSearchPaths([])).toEqual([]);
    });
  });
});
