/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const CHARACTERS_PER_CALL = 0x8000;

/**
 * Base64 of a byte array, for payloads as large as a second of PCM.
 *
 * Converts 32 KiB at a time with one `String.fromCharCode` call each: a character per call costs
 * a function call and a string concatenation per byte, and one call for the whole array overflows
 * the argument limit.
 */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHARACTERS_PER_CALL) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHARACTERS_PER_CALL));
  }
  return btoa(binary);
};
