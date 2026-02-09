/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect } from 'vitest';
import { formatPlayCategory, getFileExtension, getMountTypeForExtension, getPlayCategory, isSupportedPlayFile } from '@/lib/playback/fileTypes';

describe('fileTypes', () => {
  it('detects file categories case-insensitively', () => {
    expect(getPlayCategory('/MUSIC/SONG.SID')).toBe('sid');
    expect(getPlayCategory('demo.Mod')).toBe('mod');
    expect(getPlayCategory('game.PRG')).toBe('prg');
    expect(getPlayCategory('cart.CRT')).toBe('crt');
    expect(getPlayCategory('disk.D64')).toBe('disk');
    expect(getPlayCategory('volume.DNP')).toBeNull();
  });

  it('filters supported file types', () => {
    expect(isSupportedPlayFile('demo.sid')).toBe(true);
    expect(isSupportedPlayFile('demo.txt')).toBe(false);
  });

  it('returns mount type for disk images', () => {
    expect(getMountTypeForExtension('disk.d64')).toBe('d64');
    expect(getMountTypeForExtension('image.dnp')).toBeUndefined();
  });

  it('extracts file extensions safely', () => {
    expect(getFileExtension('/path/to/demo.sid')).toBe('sid');
    expect(getFileExtension('demo')).toBe('');
    expect(getFileExtension('.hiddenfile')).toBe('hiddenfile');
    expect(getFileExtension('archive.TAP')).toBe('tap');
  });

  it('formats play category labels', () => {
    expect(formatPlayCategory('sid')).toBe('SID music');
    expect(formatPlayCategory('mod')).toBe('MOD music');
    expect(formatPlayCategory('prg')).toBe('PRG program');
    expect(formatPlayCategory('crt')).toBe('CRT cartridge');
    expect(formatPlayCategory('disk')).toBe('Disk image');
  });
});
