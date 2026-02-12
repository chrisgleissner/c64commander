/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import SparkMD5 from 'spark-md5';

export type SidClock = 'unknown' | 'pal' | 'ntsc' | 'pal_ntsc';
export type SidModel = 'unknown' | 'mos6581' | 'mos8580' | 'both';

export type SidHeaderMetadata = {
  magicId: 'PSID' | 'RSID';
  version: number;
  dataOffset: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  songs: number;
  startSong: number;
  speedBits: number;
  flags: number | null;
  clock: SidClock;
  sid1Model: SidModel;
  sid2Model: SidModel | null;
  sid3Model: SidModel | null;
  sid2Adress: number | null;
  sid2Address: number | null;
  sidChipCount: number;
  musPlayer: boolean;
  psidSpecific: boolean | null;
  c64BasicFlag: boolean | null;
  name: string;
  author: string;
  released: string;
  rsidValid: boolean | null;
  parserWarnings: string[];
};

export type SidTrackSubsong = {
  songNr: number;
  isDefault: boolean;
};

const WINDOWS_1252_EXTENDED: Record<number, number> = {
  0x80: 0x20AC,
  0x82: 0x201A,
  0x83: 0x0192,
  0x84: 0x201E,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02C6,
  0x89: 0x2030,
  0x8A: 0x0160,
  0x8B: 0x2039,
  0x8C: 0x0152,
  0x8E: 0x017D,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201C,
  0x94: 0x201D,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02DC,
  0x99: 0x2122,
  0x9A: 0x0161,
  0x9B: 0x203A,
  0x9C: 0x0153,
  0x9E: 0x017E,
  0x9F: 0x0178,
};

const decodeWindows1252 = (bytes: Uint8Array) => {
  const chars: string[] = [];
  for (const byte of bytes) {
    if (byte === 0x00) break;
    if (byte >= 0x80 && byte <= 0x9F) {
      const mapped = WINDOWS_1252_EXTENDED[byte];
      chars.push(String.fromCodePoint(mapped ?? 0xFFFD));
      continue;
    }
    chars.push(String.fromCodePoint(byte));
  }
  return chars.join('').trim();
};

const decodeSidModel = (value: number): SidModel => {
  if (value === 0b01) return 'mos6581';
  if (value === 0b10) return 'mos8580';
  if (value === 0b11) return 'both';
  return 'unknown';
};

const decodeClock = (value: number): SidClock => {
  if (value === 0b01) return 'pal';
  if (value === 0b10) return 'ntsc';
  if (value === 0b11) return 'pal_ntsc';
  return 'unknown';
};

const decodeSidAddressByte = (byte: number): number | null => {
  if (!byte) return null;
  const address = 0xD000 + (byte << 4);
  if (address < 0xD420 || address > 0xDFF0) return null;
  return address;
};

const getBytes = (buffer: Uint8Array | ArrayBuffer) =>
  buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

export const parseSidHeaderMetadata = (buffer: Uint8Array | ArrayBuffer): SidHeaderMetadata => {
  const bytes = getBytes(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 124) {
    throw new Error(`Invalid SID header: expected at least 124 bytes, got ${view.byteLength}`);
  }
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'PSID' && magic !== 'RSID') {
    throw new Error(`Unsupported SID magic: ${magic}`);
  }

  const version = view.getUint16(4, false);
  const dataOffset = view.getUint16(6, false);
  const loadAddress = view.getUint16(8, false);
  const initAddress = view.getUint16(10, false);
  const playAddress = view.getUint16(12, false);
  const songsRaw = view.getUint16(14, false);
  const startSongRaw = view.getUint16(16, false);
  const songs = songsRaw > 0 ? songsRaw : 1;
  const startSong = startSongRaw > 0 ? Math.min(startSongRaw, songs) : 1;
  const speedBits = view.getUint32(18, false);

  const name = decodeWindows1252(bytes.subarray(22, 54));
  const author = decodeWindows1252(bytes.subarray(54, 86));
  const released = decodeWindows1252(bytes.subarray(86, 118));

  const flags = version >= 2 && view.byteLength >= 120 ? view.getUint16(118, false) : null;
  const clockBits = flags !== null ? ((flags >> 2) & 0b11) : 0;
  const sid1ModelBits = flags !== null ? ((flags >> 4) & 0b11) : 0;
  const sid2ModelBits = flags !== null ? ((flags >> 6) & 0b11) : 0;
  const sid3ModelBits = flags !== null ? ((flags >> 8) & 0b11) : 0;
  const sid2Adress = version >= 3 && view.byteLength >= 123 ? view.getUint8(122) : null;
  const sid3Adress = version >= 4 && view.byteLength >= 124 ? view.getUint8(123) : null;

  const sid2Address = sid2Adress !== null ? decodeSidAddressByte(sid2Adress) : null;
  const sid3Address = sid3Adress !== null ? decodeSidAddressByte(sid3Adress) : null;

  const sid2Model = sid2Adress ? decodeSidModel(sid2ModelBits) : null;
  const sid3Model = sid3Adress ? decodeSidModel(sid3ModelBits) : null;
  const sidChipCount = 1 + Number(Boolean(sid2Adress)) + Number(Boolean(sid3Adress));

  const parserWarnings: string[] = [];
  let rsidValid: boolean | null = null;
  if (magic === 'RSID') {
    const warnings: string[] = [];
    if (loadAddress !== 0) warnings.push('RSID requires loadAddress=0');
    if (playAddress !== 0) warnings.push('RSID requires playAddress=0');
    if (speedBits !== 0) warnings.push('RSID requires speedBits=0');
    rsidValid = warnings.length === 0;
    parserWarnings.push(...warnings);
  }

  return {
    magicId: magic,
    version,
    dataOffset,
    loadAddress,
    initAddress,
    playAddress,
    songs,
    startSong,
    speedBits,
    flags,
    clock: decodeClock(clockBits),
    sid1Model: decodeSidModel(sid1ModelBits),
    sid2Model,
    sid3Model,
    sid2Adress,
    sid2Address,
    sidChipCount,
    musPlayer: flags !== null ? Boolean(flags & 0b1) : false,
    psidSpecific: flags !== null ? Boolean((flags >> 1) & 0b1) : null,
    c64BasicFlag: flags !== null ? Boolean((flags >> 1) & 0b1) : null,
    name,
    author,
    released,
    rsidValid,
    parserWarnings,
  };
};

export const buildSidTrackSubsongs = (songs: number, startSong: number): SidTrackSubsong[] => {
  const totalSongs = Math.max(1, Math.floor(songs || 1));
  const defaultSong = Math.min(totalSongs, Math.max(1, Math.floor(startSong || 1)));
  return Array.from({ length: totalSongs }, (_, index) => {
    const songNr = index + 1;
    return {
      songNr,
      isDefault: songNr === defaultSong,
    };
  });
};

export const computeSidMd5 = async (data: ArrayBuffer) => {
  return SparkMD5.ArrayBuffer.hash(data);
};

export const createSslPayload = (durationMs: number) => {
  if (!Number.isFinite(durationMs)) {
    throw new Error('Invalid SID duration: value must be finite milliseconds');
  }
  if (durationMs < 0) {
    throw new Error('Invalid SID duration: value must be non-negative milliseconds');
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const maxSeconds = (99 * 60) + 59;
  if (totalSeconds > maxSeconds) {
    throw new Error('Invalid SID duration: maximum supported value is 99:59');
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const bcd = (value: number) => ((Math.floor(value / 10) & 0xf) << 4) | (value % 10);
  return new Uint8Array([bcd(minutes), bcd(seconds)]);
};

export const base64ToUint8 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const getSidSongCount = (buffer: ArrayBuffer) => {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 18) return 1;
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );
    if (magic !== 'PSID' && magic !== 'RSID') return 1;
    const songs = view.getUint16(14, false);
    return songs > 0 ? songs : 1;
  } catch (error) {
    const isBuffer = buffer instanceof ArrayBuffer;
    const byteLength = isBuffer ? buffer.byteLength : 0;
    const headerBytes = isBuffer
      ? Array.from(new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)))
      : [];
    console.warn('Failed to read SID song count', {
      byteLength,
      headerBytes,
      error,
    });
    return 1;
  }
};
