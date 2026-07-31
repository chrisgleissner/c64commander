/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildNowPlayingMetadata, type NowPlayingMetadataInput } from "@/lib/playback/nowPlayingMetadata";

const build = (overrides: Partial<NowPlayingMetadataInput> = {}) =>
  buildNowPlayingMetadata({
    author: "Rob Hubbard",
    released: "1985 Elite",
    sidModels: ["mos6581"],
    clock: "pal",
    tuneNumber: 1,
    tuneCount: 1,
    lengthLabel: "3:12",
    ...overrides,
  });

describe("the line under the now-playing title", () => {
  it("puts the fields in the order the page specifies, with the length last", () => {
    expect(build({ tuneNumber: 2, tuneCount: 5 })).toBe("Rob Hubbard · 1985 Elite · 6581 · PAL · Tune 2 of 5 · 3:12");
  });

  it("names one SID model per chip, so a 2SID says which two it uses", () => {
    expect(build({ sidModels: ["mos6581", "mos8580"] })).toContain("6581 / 8580");
    expect(build({ sidModels: ["mos8580", "mos8580", "mos6581"] })).toContain("8580 / 8580 / 6581");
  });

  it("says so when the header declares a tune works on either chip", () => {
    // Not the same as the header declining to say, and worth knowing, so it is spelled out rather
    // than folded into one of the two models.
    expect(build({ sidModels: ["both"] })).toContain("6581 or 8580");
  });

  it("reports the video standard from the header's flags, never from a file name", () => {
    expect(build({ clock: "ntsc" })).toContain("NTSC");
    expect(build({ clock: "pal_ntsc" })).toContain("PAL/NTSC");
    expect(build({ clock: "unknown" })).not.toContain("PAL");
    expect(build({ clock: null })).not.toContain("NTSC");
  });

  it("calls the pieces inside a file tunes, and only when there is more than one", () => {
    // "Subsong" is format jargon; a listener is choosing between tunes.
    expect(build({ tuneNumber: 3, tuneCount: 7 })).toContain("Tune 3 of 7");
    expect(build({ tuneNumber: 3, tuneCount: 7 })).not.toContain("Subsong");
    // A single-tune file says nothing: "Tune 1 of 1" is a line of noise on the great majority of SIDs.
    expect(build({ tuneNumber: 1, tuneCount: 1 })).not.toContain("Tune");
    expect(build({ tuneNumber: 1, tuneCount: null })).not.toContain("Tune");
  });

  it("drops a missing field together with its separator, so the line never shows a hole", () => {
    expect(build({ released: null, clock: "unknown", sidModels: [] })).toBe("Rob Hubbard · 3:12");
    expect(build({ author: "   ", released: null })).toBe("6581 · PAL · 3:12");
  });

  it("leaves out a chip whose model the header does not name rather than guessing at it", () => {
    expect(build({ sidModels: ["unknown"] })).toBe("Rob Hubbard · 1985 Elite · PAL · 3:12");
  });

  // The separator is a middle dot rather than a hyphen because the fields themselves contain
  // hyphens — publisher names, the PAL/NTSC clock, hyphenated tune titles. With a hyphen separator
  // the eye cannot tell which hyphens divide fields and which belong to a value.
  it("stays readable when a field contains a hyphen of its own", () => {
    const line = build({
      author: "Jeroen Tel",
      released: "1988 Maniacs of Noise - Team",
      clock: "pal_ntsc",
    });

    expect(line).toBe("Jeroen Tel · 1988 Maniacs of Noise - Team · 6581 · PAL/NTSC · 3:12");
    // Every separator in the line is the dot; the hyphen that remains belongs to the publisher.
    expect(line.split(" · ")).toHaveLength(5);
    expect(build({ sidModels: ["mos6581", "unknown"] })).toContain("6581");
    expect(build({ sidModels: ["mos6581", "unknown"] })).not.toContain("6581 /");
  });

  it("says nothing at all for a header that carried nothing", () => {
    expect(
      build({ author: null, released: null, sidModels: [], clock: null, tuneCount: null, lengthLabel: null }),
    ).toBeNull();
  });
});
