import { describe, it, expect } from 'vitest';
import { getMountTypeForExtension, getPlayCategory, isSupportedPlayFile } from '@/lib/playback/fileTypes';

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
});
