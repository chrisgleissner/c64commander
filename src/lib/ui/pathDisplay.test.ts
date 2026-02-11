/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { fitPathToWidth, getFileNameFromPath } from './pathDisplay';

const monoMeasure = (value: string) => value.length;

describe('pathDisplay', () => {
  it('extracts filename from paths', () => {
    expect(getFileNameFromPath('/a/b/c/file.sid')).toBe('file.sid');
    expect(getFileNameFromPath('file.sid')).toBe('file.sid');
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
});
