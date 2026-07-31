/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { fromEngineTuneIndex, toEngineTuneIndex } from "@/lib/playback/sidTuneIndex";

describe("SID tune numbering", () => {
  it("maps the first tune to index 0", () => {
    // The case that was unreachable: asking for tune 1 selected tune 2, so a multi-tune file's
    // opening tune could not be played at all.
    expect(toEngineTuneIndex(1)).toBe(0);
  });

  it("maps a later tune to the index one below its number", () => {
    expect(toEngineTuneIndex(2)).toBe(1);
    expect(toEngineTuneIndex(11)).toBe(10);
    expect(toEngineTuneIndex(30)).toBe(29);
  });

  it("treats a missing or nonsensical number as the file's first tune", () => {
    // `songNr` is optional throughout the playlist, and 0 is what an unset field reads as in older
    // persisted playlists. Both mean "whatever the file starts with", which is index 0.
    expect(toEngineTuneIndex(undefined)).toBe(0);
    expect(toEngineTuneIndex(null)).toBe(0);
    expect(toEngineTuneIndex(0)).toBe(0);
    expect(toEngineTuneIndex(-4)).toBe(0);
    expect(toEngineTuneIndex(Number.NaN)).toBe(0);
  });

  it("truncates a non-integer rather than handing the engine a fraction", () => {
    expect(toEngineTuneIndex(3.9)).toBe(2);
  });

  it("round-trips back to the number a listener sees", () => {
    for (const songNr of [1, 2, 7, 30]) {
      expect(fromEngineTuneIndex(toEngineTuneIndex(songNr))).toBe(songNr);
    }
  });

  it("never reports a tune number below 1", () => {
    expect(fromEngineTuneIndex(0)).toBe(1);
    expect(fromEngineTuneIndex(-1)).toBe(1);
    expect(fromEngineTuneIndex(Number.NaN)).toBe(1);
  });
});
