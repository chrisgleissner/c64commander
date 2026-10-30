/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { buildTuneShare, tuneShareForItem } from "@/lib/playback/tuneShare";
import { buildFoundTuneItem, buildRecentPlaylistItem } from "@/pages/playFiles/insertTuneNext";
import type { PlaylistItem } from "@/pages/playFiles/types";

const COMMANDO = {
  title: "Commando",
  composer: "Rob Hubbard",
  released: "1985 Elite",
  virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
  songNr: 1,
  subsongCount: 1,
};

describe("buildTuneShare", () => {
  it("links a single-tune file to DeepSID without a subtune and names it on one line", () => {
    expect(buildTuneShare(COMMANDO)).toEqual({
      title: "Commando",
      text: "Commando by Rob Hubbard (1985)",
      url: "https://deepsid.chordian.net/?file=/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    });
  });

  it("adds the 1-based subtune and a second line for a file that holds several tunes", () => {
    const share = buildTuneShare({ ...COMMANDO, songNr: 3, subsongCount: 19 });
    expect(share.url).toBe("https://deepsid.chordian.net/?file=/MUSICIANS/H/Hubbard_Rob/Commando.sid&subtune=3");
    expect(share.text).toBe("Commando by Rob Hubbard (1985)\nTune 3 of 19");
  });

  it("writes subtune=1 for the first tune of a multi-tune file, because DeepSID counts from one", () => {
    expect(buildTuneShare({ ...COMMANDO, songNr: 1, subsongCount: 2 }).url).toMatch(/&subtune=1$/);
  });

  it("keeps the tune number inside the file when the caller passes one outside it", () => {
    expect(buildTuneShare({ ...COMMANDO, songNr: 40, subsongCount: 19 }).url).toMatch(/&subtune=19$/);
    expect(buildTuneShare({ ...COMMANDO, songNr: 0, subsongCount: 19 }).url).toMatch(/&subtune=1$/);
  });

  it("omits an unknown composer and an unknown year without leaving a gap", () => {
    expect(buildTuneShare({ ...COMMANDO, composer: null, released: null }).text).toBe("Commando");
    expect(buildTuneShare({ ...COMMANDO, composer: "Rob Hubbard", released: null }).text).toBe(
      "Commando by Rob Hubbard",
    );
    expect(buildTuneShare({ ...COMMANDO, composer: null, released: "1985 Elite" }).text).toBe("Commando (1985)");
  });

  it.each([["<?>"], ["19?? Someone"], [""], ["   "], ["Elite"]])("takes %j as an unknown year", (released) => {
    expect(buildTuneShare({ ...COMMANDO, released }).text).toBe("Commando by Rob Hubbard");
  });

  it("takes the first year of a range, because HVSC writes ranges as 1990-91", () => {
    expect(buildTuneShare({ ...COMMANDO, released: "1990-91 Someone" }).text).toBe("Commando by Rob Hubbard (1990)");
  });

  it.each([["<?>"], [""], [null]])("takes %j as an unknown composer", (composer) => {
    expect(buildTuneShare({ ...COMMANDO, composer }).text).toBe("Commando (1985)");
  });

  it("falls back to the file name when the tune has no title", () => {
    const share = buildTuneShare({ ...COMMANDO, title: "  " });
    expect(share.title).toBe("Commando");
    expect(share.text).toBe("Commando by Rob Hubbard (1985)");
  });

  /*
   * A path from the real HVSC: Kit Barlow's `Blue Screen Waltz 2.sid`. DeepSID's updateURL
   * (js/main.js) writes the folder path and file name into `?file=` with slashes kept and puts the
   * result in the address bar, where the browser serializes a space as %20. encodeURIComponent
   * produces the same bytes for this path, and DeepSID reads it back through URL decoding.
   */
  it("encodes a space in a real HVSC file name the way DeepSID's own address bar does", () => {
    const share = buildTuneShare({
      ...COMMANDO,
      title: "Blue Screen Waltz 2",
      composer: "Kit Barlow",
      virtualPath: "/MUSICIANS/B/Barlow_Kit/Blue Screen Waltz 2.sid",
    });
    expect(share.url).toBe("https://deepsid.chordian.net/?file=/MUSICIANS/B/Barlow_Kit/Blue%20Screen%20Waltz%202.sid");
  });

  it("encodes an ampersand in a segment, so it cannot start a second query parameter", () => {
    const share = buildTuneShare({
      ...COMMANDO,
      virtualPath: "/MUSICIANS/T/Tel & Deenen/Rock & Roll #1.sid",
      songNr: 2,
      subsongCount: 3,
    });
    expect(share.url).toBe(
      "https://deepsid.chordian.net/?file=/MUSICIANS/T/Tel%20%26%20Deenen/Rock%20%26%20Roll%20%231.sid&subtune=2",
    );
    expect(new URL(share.url).searchParams.get("file")).toBe("/MUSICIANS/T/Tel & Deenen/Rock & Roll #1.sid");
    expect(new URL(share.url).searchParams.get("subtune")).toBe("2");
  });

  it("drops the collection folder prefix DeepSID omits", () => {
    const share = buildTuneShare({ ...COMMANDO, virtualPath: "/High Voltage SID Collection/MUSICIANS/H/H.sid" });
    expect(share.url).toBe("https://deepsid.chordian.net/?file=/MUSICIANS/H/H.sid");
  });
});

describe("tuneShareForItem", () => {
  const found = (virtualPath = COMMANDO.virtualPath, songNr = 1) =>
    buildFoundTuneItem({ virtualPath, title: "Commando", songNr, subsongCount: 19 });

  it("shares a tune found in the archive and carries the path for the error log", () => {
    const share = tuneShareForItem(found(COMMANDO.virtualPath, 3), { author: "Rob Hubbard", released: "1985 Elite" });
    expect(share).toEqual({
      title: "Commando",
      text: "Commando by Rob Hubbard (1985)\nTune 3 of 19",
      url: "https://deepsid.chordian.net/?file=/MUSICIANS/H/Hubbard_Rob/Commando.sid&subtune=3",
      path: COMMANDO.virtualPath,
    });
  });

  it("prefers the count and title the caller has seen over the item's", () => {
    const share = tuneShareForItem(found(), { author: null, released: null }, 2, "Commando (Remix)");
    expect(share?.title).toBe("Commando (Remix)");
    expect(share?.url).toMatch(/&subtune=1$/);
  });

  it("names a tune by its file name when nothing better is known", () => {
    expect(tuneShareForItem(found())?.title).toBe("Commando");
  });

  it("builds a Recent entry from the archive the same way as a found tune", () => {
    const item = buildRecentPlaylistItem({ virtualPath: COMMANDO.virtualPath, title: "Commando" });
    expect(tuneShareForItem(item)?.url).toBe(
      "https://deepsid.chordian.net/?file=/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    );
  });

  const notInTheArchive: [string, PlaylistItem][] = [
    [
      "a file from the phone",
      {
        id: "l",
        request: { source: "local", path: "/storage/emulated/0/SID/Commando.sid" },
        category: "sid",
        label: "Commando.sid",
        path: "/storage/emulated/0/SID/Commando.sid",
      },
    ],
    [
      "a file on the Ultimate",
      {
        id: "u",
        request: { source: "ultimate", path: "/USB0/Commando.sid" },
        category: "sid",
        label: "Commando.sid",
        path: "/USB0/Commando.sid",
      },
    ],
    [
      "a CommoServe entry",
      {
        id: "c",
        request: { source: "commoserve", path: "/x/Commando.sid" },
        category: "sid",
        label: "Commando.sid",
        path: "/x/Commando.sid",
      },
    ],
    [
      "a disk played from the archive source",
      {
        id: "d",
        request: { source: "hvsc", path: "/x/game.d64" },
        category: "disk",
        label: "game.d64",
        path: "/x/game.d64",
      },
    ],
  ];

  it.each(notInTheArchive)("offers nothing for %s, so no private path leaves the phone", (_name, item) => {
    expect(tuneShareForItem(item)).toBeNull();
  });

  it("offers nothing when there is no tune", () => {
    expect(tuneShareForItem(null)).toBeNull();
    expect(tuneShareForItem(undefined)).toBeNull();
  });
});
