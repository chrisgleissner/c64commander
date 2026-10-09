/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Reading the Ultimate SID player's own clock out of screen memory.
 *
 * The player draws "mm:ss" at the start of screen row 23. It is the only position the device
 * offers, and it is exact to the second: the player counts it from the frames it plays. The screen
 * moves with the tune, because the player places it wherever the tune leaves room ($0800 and $8C00
 * were both seen), so its address is read back from the VIC each time a tune starts.
 */

export const SID_PLAYER_CLOCK_OFFSET = 23 * 40;
const SID_PLAYER_TITLE_MARKER = "SID PLAYER";

/** Where the VIC reads screen memory: the CIA 2 bank bits ($DD00) and the matrix nibble of $D018. */
export const sidPlayerScreenAddress = (dd00: number, d018: number): number =>
  (3 - (dd00 & 0x03)) * 0x4000 + ((d018 >> 4) & 0x0f) * 0x400;

/** Screen codes as text: letters, digits and punctuation; anything else is ".". */
export const screenCodesToText = (codes: Uint8Array): string =>
  Array.from(codes, (raw) => {
    const code = raw & 0x7f;
    if (code >= 1 && code <= 26) return String.fromCharCode(code + 64);
    if (code >= 0x20 && code <= 0x3f) return String.fromCharCode(code);
    return ".";
  }).join("");

export const isSidPlayerTitle = (codes: Uint8Array): boolean =>
  screenCodesToText(codes).includes(SID_PLAYER_TITLE_MARKER);

/** Seconds on the player's clock, or null when the five cells are not a clock. */
export const parseSidPlayerClock = (codes: Uint8Array): number | null => {
  const text = screenCodesToText(codes);
  const match = /^(\d\d):([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
