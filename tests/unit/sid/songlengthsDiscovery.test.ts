/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { buildSonglengthsSearchPaths, collectSonglengthsSearchPaths, DOCUMENTS_FOLDER, SONGLENGTHS_FILE_NAMES } from '@/lib/sid/songlengthsDiscovery';

const normalize = (paths: string[]) => paths.map((path) => path.replace(/\\/g, '/'));

describe('songlengthsDiscovery', () => {
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

  it('normalizes a relative path (no leading slash) to absolute before searching', () => {
    // Covers the normalizeLocalPath false branch where path does not start with '/'
    const paths = buildSonglengthsSearchPaths('Music/demo.sid');
    const normalized = normalize(paths);
    SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
      expect(normalized).toContain(`/Music/${fileName}`);
      expect(normalized).toContain(`/${fileName}`);
    });
  });

  it('handles empty path as root and returns root-level search paths', () => {
    // Covers the path || '/' fallback branch when path is empty
    const paths = buildSonglengthsSearchPaths('');
    const normalized = normalize(paths);
    SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
      expect(normalized).toContain(`/${fileName}`);
      expect(normalized).toContain(`/${DOCUMENTS_FOLDER}/${fileName}`);
    });
    // Empty path resolves to root only — no parent traversal should occur
    expect(paths.length).toBe(SONGLENGTHS_FILE_NAMES.length * 2);
  });

  it('handles path already ending with slash (directory path)', () => {
    // Covers the normalized.endsWith('/') true branch in buildSonglengthsSearchPaths
    const paths = buildSonglengthsSearchPaths('/Music/DEMOS/');
    const normalized = normalize(paths);
    SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
      expect(normalized).toContain(`/Music/DEMOS/${fileName}`);
      expect(normalized).toContain(`/Music/${fileName}`);
      expect(normalized).toContain(`/${fileName}`);
    });
  });

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
});
