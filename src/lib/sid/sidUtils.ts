/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import SparkMD5 from 'spark-md5';

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
