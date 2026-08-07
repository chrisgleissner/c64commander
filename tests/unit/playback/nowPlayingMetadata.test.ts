/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildNowPlayingMetadata,
  buildNowPlayingMetadataParts,
  buildStilTuneLine,
  type NowPlayingMetadataInput,
} from "@/lib/playback/nowPlayingMetadata";

const base: NowPlayingMetadataInput = {
  author: "Rob Hubbard",
  released: "1985 Elite",
  sidModels: ["mos6581"],
  clock: "pal",
  tuneNumber: 1,
  tuneCount: 1,
  lengthLabel: "3:12",
};

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
    expect(build({ tuneNumber: 2, tuneCount: 5 })).toBe("Rob Hubbard · 1985 Elite · 6581 · PAL · 2/5 · 3:12");
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

  it("gives the tune position as a fraction, and only when there is more than one", () => {
    // "3/7", not "Tune 3 of 7": the facts line is read as a row of short values, and the long
    // form spent most of a 320px line restating what the position already says. "Subsong" is
    // format jargon and never appears either way.
    expect(build({ tuneNumber: 3, tuneCount: 7 })).toContain("3/7");
    expect(build({ tuneNumber: 3, tuneCount: 7 })).not.toContain("Subsong");
    expect(build({ tuneNumber: 3, tuneCount: 7 })).not.toContain("Tune 3 of 7");
    // A single-tune file says nothing: "1/1" is a line of noise on the great majority of SIDs.
    expect(build({ tuneNumber: 1, tuneCount: 1 })).not.toContain("1/1");
    expect(build({ tuneNumber: 1, tuneCount: null })).not.toMatch(/\d+\/\d+/);
  });

  it("splits the fields into a credits row and a facts row", () => {
    // The card prints these as two lines so the dislike and favourite actions can sit at the
    // right of the second one instead of taking a row of their own.
    const parts = buildNowPlayingMetadataParts({ ...base, tuneNumber: 2, tuneCount: 5 });
    const row = (name: string) => parts.filter((part) => part.row === name).map((part) => part.text);

    expect(row("credits")).toEqual(["Rob Hubbard", "1985 Elite"]);
    expect(row("facts")).toEqual(["6581", "PAL", "2/5", "3:12"]);
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

describe("buildStilTuneLine", () => {
  it("names the tune and who wrote the music", () => {
    // Commando: the SID header says Rob Hubbard, who arranged the arcade score. This line is the
    // only place the person who actually wrote it appears.
    expect(buildStilTuneLine({ title: "BGM1", originalArtist: "Tamayo Kawamoto" })).toBe(
      "BGM1 · music by Tamayo Kawamoto",
    );
  });

  it("shows a title on its own", () => {
    expect(buildStilTuneLine({ title: "Central Park", originalArtist: null })).toBe("Central Park");
  });

  it("shows the original composer even when STIL gave the tune no name", () => {
    expect(buildStilTuneLine({ title: null, originalArtist: "Jean-Michel Jarre" })).toBe("music by Jean-Michel Jarre");
  });

  it("says nothing for the majority of the archive, which STIL does not describe", () => {
    expect(buildStilTuneLine({ title: null, originalArtist: null })).toBeNull();
    expect(buildStilTuneLine({ title: "  ", originalArtist: "  " })).toBeNull();
  });
});
