/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { buildPlaylistRowSubtitle } from "@/pages/playFiles/playlistRowSubtitle";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (overrides: Partial<PlaylistItem> & { songNr?: number }): PlaylistItem =>
  ({
    id: "id",
    label: "Commando.sid",
    path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    category: "sid",
    request: { source: "hvsc", path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", songNr: overrides.songNr },
    ...overrides,
  }) as unknown as PlaylistItem;

describe("buildPlaylistRowSubtitle", () => {
  it("shows the path for an ordinary single-tune row", () => {
    expect(buildPlaylistRowSubtitle(item({}))).toBe("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
  });

  it("shows which tune it is once a file has been expanded", () => {
    // The point: without this every one of the nineteen rows reads identically.
    expect(buildPlaylistRowSubtitle(item({ songNr: 7, subsongCount: 19 }))).toBe("Tune 7 of 19");
  });

  it("adds the tune's name when STIL has one", () => {
    expect(buildPlaylistRowSubtitle(item({ songNr: 1, subsongCount: 19, tuneTitle: "BGM1" }))).toBe(
      "Tune 1 of 19 · BGM1",
    );
  });

  it("keeps the path on a single-tune file even when a song number is set", () => {
    // "Tune 1 of 1" distinguishes nothing, so the path remains the more useful line.
    expect(buildPlaylistRowSubtitle(item({ songNr: 1, subsongCount: 1 }))).toBe(
      "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    );
  });

  it("ignores a blank title rather than leaving a dangling separator", () => {
    expect(buildPlaylistRowSubtitle(item({ songNr: 2, subsongCount: 19, tuneTitle: "   " }))).toBe("Tune 2 of 19");
  });
});
