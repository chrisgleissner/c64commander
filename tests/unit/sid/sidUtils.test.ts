/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { base64ToUint8, buildSidTrackSubsongs, createSslPayload, getSidSongCount, parseSidHeaderMetadata } from '@/lib/sid/sidUtils';

const createSidHeader = (options?: {
  magic?: 'PSID' | 'RSID';
  version?: number;
  songs?: number;
  startSong?: number;
  speedBits?: number;
  flags?: number;
  loadAddress?: number;
  playAddress?: number;
  nameBytes?: number[];
}) => {
  const bytes = new Uint8Array(124);
  const view = new DataView(bytes.buffer);
  const magic = options?.magic ?? 'PSID';
  bytes.set(Array.from(magic).map((char) => char.charCodeAt(0)), 0);
  view.setUint16(4, options?.version ?? 4, false);
  view.setUint16(6, 0x007c, false);
  view.setUint16(8, options?.loadAddress ?? 0x1000, false);
  view.setUint16(10, 0x1003, false);
  view.setUint16(12, options?.playAddress ?? 0x1006, false);
  view.setUint16(14, options?.songs ?? 3, false);
  view.setUint16(16, options?.startSong ?? 2, false);
  view.setUint32(18, options?.speedBits ?? 0x00000000, false);
  view.setUint16(118, options?.flags ?? 0b0101010101, false);
  view.setUint8(122, 0x42);
  view.setUint8(123, 0x44);
  const nameBytes = options?.nameBytes ?? [0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x00];
  bytes.set(nameBytes, 22);
  bytes.set([0x41, 0x75, 0x74, 0x68, 0x6F, 0x72, 0x00], 54);
  bytes.set([0x31, 0x39, 0x38, 0x36, 0x00], 86);
  return bytes;
};

describe('sidUtils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs when SID song count parsing fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    class ThrowingDataView {
      constructor() {
        throw new Error('boom');
      }
    }
    vi.stubGlobal('DataView', ThrowingDataView as unknown as typeof DataView);

    expect(getSidSongCount(new ArrayBuffer(4))).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to read SID song count',
      expect.objectContaining({
        byteLength: 4,
      }),
    );
  });

  it('encodes zero duration as 00:00', () => {
    expect(Array.from(createSslPayload(0))).toEqual([0x00, 0x00]);
  });

  it('encodes maximum supported duration 99:59', () => {
    expect(Array.from(createSslPayload((99 * 60 * 1000) + (59 * 1000)))).toEqual([0x99, 0x59]);
  });

  it('throws for negative duration', () => {
    expect(() => createSslPayload(-1)).toThrow('non-negative');
  });

  it('throws for non-finite duration', () => {
    expect(() => createSslPayload(Number.NaN)).toThrow('finite');
    expect(() => createSslPayload(Number.POSITIVE_INFINITY)).toThrow('finite');
  });

  it('throws for values exceeding 99:59', () => {
    expect(() => createSslPayload((100 * 60 * 1000))).toThrow('99:59');
  });

  it('parses PSID metadata fields', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader());
    expect(metadata.magicId).toBe('PSID');
    expect(metadata.version).toBe(4);
    expect(metadata.songs).toBe(3);
    expect(metadata.startSong).toBe(2);
    expect(metadata.name).toBe('Hello');
    expect(metadata.author).toBe('Author');
    expect(metadata.released).toBe('1986');
    expect(metadata.sid2Adress).toBe(0x42);
    expect(metadata.sid2Address).toBe(0xD420);
    expect(metadata.sidChipCount).toBe(3);
  });

  it('decodes Windows-1252 metadata strings', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader({
      nameBytes: [0x50, 0x72, 0x69, 0x63, 0x65, 0x20, 0x80, 0x00],
    }));
    expect(metadata.name).toBe('Price €');
  });

  it('flags invalid RSID constraints without throwing', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader({
      magic: 'RSID',
      loadAddress: 0x1000,
      playAddress: 0x1006,
      speedBits: 1,
    }));
    expect(metadata.magicId).toBe('RSID');
    expect(metadata.rsidValid).toBe(false);
    expect(metadata.parserWarnings.length).toBeGreaterThan(0);
  });

  it('builds deterministic subsong rows', () => {
    expect(buildSidTrackSubsongs(3, 2)).toEqual([
      { songNr: 1, isDefault: false },
      { songNr: 2, isDefault: true },
      { songNr: 3, isDefault: false },
    ]);
  });

  it('defaults to 1 song when songs is 0', () => {
    const result = buildSidTrackSubsongs(0, 1);
    expect(result).toHaveLength(1);
    expect(result[0].isDefault).toBe(true);
  });

  it('defaults to 1 song when songs is NaN', () => {
    const result = buildSidTrackSubsongs(NaN, 1);
    expect(result).toHaveLength(1);
  });

  it('defaults startSong to 1 when NaN', () => {
    const result = buildSidTrackSubsongs(3, NaN);
    expect(result[0].isDefault).toBe(true);
  });

  it('clamps startSong to totalSongs', () => {
    const result = buildSidTrackSubsongs(2, 10);
    expect(result.find((s) => s.isDefault)!.songNr).toBe(2);
  });

  it('throws for header shorter than 124 bytes', () => {
    expect(() => parseSidHeaderMetadata(new Uint8Array(100))).toThrow('124 bytes');
  });

  it('throws for unsupported magic', () => {
    const bytes = new Uint8Array(124);
    bytes.set([0x4D, 0x41, 0x47, 0x49], 0); // 'MAGI'
    expect(() => parseSidHeaderMetadata(bytes)).toThrow('Unsupported SID magic');
  });

  it('defaults songs to 1 when songs field is 0', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader({ songs: 0 }));
    expect(metadata.songs).toBe(1);
  });

  it('defaults startSong to 1 when startSong field is 0', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader({ startSong: 0 }));
    expect(metadata.startSong).toBe(1);
  });

  it('clamps startSong when greater than songs', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader({ songs: 2, startSong: 5 }));
    expect(metadata.startSong).toBe(2);
  });

  it('parses version 1 header with null flags', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader({ version: 1 }));
    expect(metadata.flags).toBeNull();
    expect(metadata.psidSpecific).toBeNull();
    expect(metadata.c64BasicFlag).toBeNull();
    expect(metadata.clock).toBe('unknown');
    expect(metadata.sid1Model).toBe('unknown');
    expect(metadata.musPlayer).toBe(false);
  });

  it('parses version 2 header with null sid2 address', () => {
    const header = createSidHeader({ version: 2 });
    const metadata = parseSidHeaderMetadata(header);
    expect(metadata.sid2Adress).toBeNull();
    expect(metadata.sid2Address).toBeNull();
  });

  it('parses version 3 header with null sid3 address', () => {
    const header = createSidHeader({ version: 3 });
    const metadata = parseSidHeaderMetadata(header);
    expect(metadata.sid2Adress).toBe(0x42);
    // sid3Adress only available in version >= 4
    expect(metadata.sidChipCount).toBe(2);
  });

  it('validates valid RSID with all zero constraints', () => {
    const metadata = parseSidHeaderMetadata(createSidHeader({
      magic: 'RSID',
      loadAddress: 0,
      playAddress: 0,
      speedBits: 0,
    }));
    expect(metadata.rsidValid).toBe(true);
    expect(metadata.parserWarnings).toHaveLength(0);
  });

  it('accepts ArrayBuffer input not just Uint8Array', () => {
    const header = createSidHeader();
    const metadata = parseSidHeaderMetadata(header.buffer as ArrayBuffer);
    expect(metadata.magicId).toBe('PSID');
  });

  it('decodes unmapped Windows-1252 byte as replacement character', () => {
    // 0x81 is NOT in the WINDOWS_1252_EXTENDED map
    const metadata = parseSidHeaderMetadata(createSidHeader({
      nameBytes: [0x41, 0x81, 0x42, 0x00],
    }));
    expect(metadata.name).toContain('\uFFFD');
  });

  it('returns 1 for buffer shorter than 18 bytes', () => {
    expect(getSidSongCount(new ArrayBuffer(10))).toBe(1);
  });

  it('returns 1 for buffer with bad magic', () => {
    const buf = new ArrayBuffer(20);
    const view = new DataView(buf);
    view.setUint8(0, 0x4D); // M
    view.setUint8(1, 0x41); // A
    view.setUint8(2, 0x47); // G
    view.setUint8(3, 0x49); // I
    expect(getSidSongCount(buf)).toBe(1);
  });

  it('returns 1 when songs field is 0 in getSidSongCount', () => {
    const buf = new ArrayBuffer(20);
    const view = new DataView(buf);
    // PSID header
    view.setUint8(0, 0x50); // P
    view.setUint8(1, 0x53); // S
    view.setUint8(2, 0x49); // I
    view.setUint8(3, 0x44); // D
    view.setUint16(14, 0, false); // 0 songs
    expect(getSidSongCount(buf)).toBe(1);
  });

  it('returns correct song count for valid buffer', () => {
    const buf = new ArrayBuffer(20);
    const view = new DataView(buf);
    view.setUint8(0, 0x50); // P
    view.setUint8(1, 0x53); // S
    view.setUint8(2, 0x49); // I
    view.setUint8(3, 0x44); // D
    view.setUint16(14, 5, false);
    expect(getSidSongCount(buf)).toBe(5);
  });

  it('decodes base64 to Uint8Array', () => {
    const result = base64ToUint8('AQID'); // [1, 2, 3]
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it('parses sid2Address out of range returns null', () => {
    // sid2Adress byte that produces address < 0xD420 (e.g. byte=0x01 -> 0xD010)
    const header = createSidHeader({ version: 4 });
    const view = new DataView(header.buffer);
    view.setUint8(122, 0x01); // 0xD010, out of range
    const metadata = parseSidHeaderMetadata(header);
    expect(metadata.sid2Address).toBeNull();
  });

  it('parses sid2Address byte of 0 returns null', () => {
    const header = createSidHeader({ version: 4 });
    const view = new DataView(header.buffer);
    view.setUint8(122, 0x00);
    const metadata = parseSidHeaderMetadata(header);
    expect(metadata.sid2Adress).toBe(0);
    expect(metadata.sid2Address).toBeNull();
    expect(metadata.sid2Model).toBeNull();
    expect(metadata.sidChipCount).toBe(2); // sid3Adress still set
  });
});
