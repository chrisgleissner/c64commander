/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { fitPathToWidth, getFileNameFromPath } from './pathDisplay';

const monoMeasure = (value: string) => value.length;

describe('pathDisplay', () => {
  it('extracts filename from paths', () => {
    expect(getFileNameFromPath('/a/b/c/file.sid')).toBe('file.sid');
    expect(getFileNameFromPath('file.sid')).toBe('file.sid');
    expect(getFileNameFromPath('C:\\music\\folder\\file.sid')).toBe('file.sid');
    expect(getFileNameFromPath('')).toBe('');
  });

  it('uses filename fallback when full path does not fit', () => {
    const path = '/C64Music/DEMOS/Very/Long/Folder/file.sid';
    expect(fitPathToWidth(path, path.length, monoMeasure, 'filename-fallback')).toBe(path);
    expect(fitPathToWidth(path, 20, monoMeasure, 'filename-fallback')).toBe('file.sid');
  });

  it('preserves start and filename with middle ellipsis', () => {
    const path = '/C64Music/DEMOS/Very/Long/Folder/file.sid';
    const display = fitPathToWidth(path, 27, monoMeasure, 'start-and-filename');
    expect(display).toBe('/C64Music/.../file.sid');
  });

  it('does not prepend ellipsis for plain filenames', () => {
    const display = fitPathToWidth('Disk 1.d64', 20, monoMeasure, 'start-and-filename');
    expect(display).toBe('Disk 1.d64');
  });

  it('preserves full filename when width is very small', () => {
    const path = '/C64Music/DEMOS/Very/Long/Folder/superlongfilename.sid';
    const display = fitPathToWidth(path, 10, monoMeasure, 'start-and-filename');
    expect(display).toBe('superlongfilename.sid');
  });

  it('returns original path when path is empty or max width is non-positive', () => {
    expect(fitPathToWidth('', 10, monoMeasure, 'filename-fallback')).toBe('');
    expect(fitPathToWidth('/a/b/file.sid', 0, monoMeasure, 'filename-fallback')).toBe('/a/b/file.sid');
    expect(fitPathToWidth('/a/b/file.sid', -5, monoMeasure, 'start-and-filename')).toBe('/a/b/file.sid');
  });

  it('falls back to empty label when ellipsis cannot fit', () => {
    const path = '/very/long/path/file.sid';
    expect(fitPathToWidth(path, 2, monoMeasure, 'filename-fallback')).toBe('');
  });

  it('trims path with trailing slash in start-and-filename mode', () => {
    const path = '/very/long/path/';
    const display = fitPathToWidth(path, 10, monoMeasure, 'start-and-filename');
    expect(display).toBe('/.../path');
  });
});
