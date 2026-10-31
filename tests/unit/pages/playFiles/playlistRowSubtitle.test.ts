/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";

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
  beforeEach(() => {
    vi.spyOn(LocalSidPlaybackController, "isSupported").mockReturnValue(true);
  });

  it("shows no second line for an ordinary single-tune row: the file name is on the details menu", () => {
    expect(buildPlaylistRowSubtitle(item({}))).toBeNull();
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

  it("treats a single-tune file as an ordinary row even when a song number is set", () => {
    expect(buildPlaylistRowSubtitle(item({ songNr: 1, subsongCount: 1 }))).toBeNull();
  });

  it("ignores a blank title rather than leaving a dangling separator", () => {
    expect(buildPlaylistRowSubtitle(item({ songNr: 2, subsongCount: 19, tuneTitle: "   " }))).toBe("Tune 2 of 19");
  });
});

describe("buildPlaylistRowSubtitle in SID Player", () => {
  const program = item({
    category: "prg",
    path: "/GAMES/Game.prg",
    label: "Game.prg",
    request: { source: "local", path: "/GAMES/Game.prg" },
  } as Partial<PlaylistItem>);

  it("SPM-PLAY-03 SID Player marks a program row as needing a C64 Ultimate", () => {
    expect(buildPlaylistRowSubtitle(program, { sidPlayer: true })).toBe("Needs a C64 Ultimate");
  });

  it("SPM-PLAY-03 the Full App shows no such mark", () => {
    expect(buildPlaylistRowSubtitle(program)).toBeNull();
    expect(buildPlaylistRowSubtitle(program, { sidPlayer: false })).toBeNull();
  });

  it("SPM-PLAY-03 a SID tune on the phone is not marked, and keeps its tune line", () => {
    expect(buildPlaylistRowSubtitle(item({}), { sidPlayer: true })).toBeNull();
    expect(buildPlaylistRowSubtitle(item({ songNr: 3, subsongCount: 5 }), { sidPlayer: true })).toBe("Tune 3 of 5");
  });

  it("SPM-PLAY-03 a tune that only the Ultimate holds is marked", () => {
    const remote = item({ request: { source: "ultimate", path: "/USB0/a.sid" } } as Partial<PlaylistItem>);
    expect(buildPlaylistRowSubtitle(remote, { sidPlayer: true })).toBe("Needs a C64 Ultimate");
  });
});
