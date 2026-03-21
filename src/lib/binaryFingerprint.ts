/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type BinaryFingerprint = {
  byteLength: number;
  fnv1a32: string;
  headHex: string;
  tailHex: string;
};

const toHex = (value: number) => value.toString(16).padStart(2, "0");

export const buildBinaryFingerprint = (bytes: Uint8Array): BinaryFingerprint => {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const previewSize = Math.min(16, bytes.length);
  return {
    byteLength: bytes.byteLength,
    fnv1a32: hash.toString(16).padStart(8, "0"),
    headHex: Array.from(bytes.slice(0, previewSize), toHex).join(""),
    tailHex: Array.from(bytes.slice(Math.max(0, bytes.length - previewSize)), toHex).join(""),
  };
};
