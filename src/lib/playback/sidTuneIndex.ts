/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The two ways a tune inside a `.sid` file is numbered, and the one place that converts between them.
 *
 * Everything a listener sees or that identifies a tune is **one-based**: the PSID header's
 * `startSong`, HVSC songlengths, `PlaylistItem.request.songNr`, the similarity bundle's
 * `resolveTrack().songIndex`, and "Tune 3 of 9" on screen. One-based is the C64 world's own
 * convention and there is no reason to fight it.
 *
 * `libsidplayfp-wasm`'s `loadSidBuffer(data, songIndex)` is **zero-based**. Its `patchStartSong`
 * writes `Math.trunc(songIndex) + 1` into the header, clamped to the file's tune count, so passing
 * the one-based number selects the tune after the one intended.
 *
 * That mismatch shipped: `usePlaybackController` handed `request.songNr` straight to the engine, so
 * on-device playback rendered tune 2 when asked for tune 1, and the first tune of every multi-tune
 * SID could not be reached at all. Measured against the real engine on
 * `MUSICIANS/J/Joseph_Richard/Wicked.sid` (30 tunes): requesting 1 reported `currentSong: 2`,
 * requesting 11 reported 12, and requesting 29 reported 30. The clamp hid it at the top end, which
 * is why it looked like only some files were wrong.
 *
 * It was not only the wrong music. The songlength — and therefore the auto-advance deadline — is
 * resolved from the one-based number, so the clock belonged to a different tune than the one
 * playing.
 *
 * Conversion happens here and nowhere else. Anything holding a `songNr` keeps it one-based right up
 * to the engine call.
 */

/**
 * Convert a listener-facing, one-based tune number to the zero-based index the WASM engine expects.
 *
 * A missing or nonsensical number means "the file's first tune", which is index 0 — the same answer
 * the engine reaches by clamping, but arrived at deliberately rather than by accident.
 */
export const toEngineTuneIndex = (songNr: number | null | undefined): number => {
  if (typeof songNr !== "number" || !Number.isFinite(songNr)) return 0;
  return Math.max(0, Math.trunc(songNr) - 1);
};

/**
 * The inverse, for anything that has an engine index and needs to describe it to a listener.
 */
export const fromEngineTuneIndex = (songIndex: number): number => {
  if (!Number.isFinite(songIndex)) return 1;
  return Math.max(1, Math.trunc(songIndex) + 1);
};
