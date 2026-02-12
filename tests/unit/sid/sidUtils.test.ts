/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildSidTrackSubsongs, createSslPayload, getSidSongCount, parseSidHeaderMetadata } from '@/lib/sid/sidUtils';

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
});
