/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRecentlyPlayed,
  loadRecentlyPlayed,
  RECENTLY_PLAYED_LIMIT,
  saveRecentlyPlayed,
  toRecentlyPlayedEntry,
  withRecentlyPlayed,
} from "@/lib/sidRadio/recentlyPlayed";

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

/**
 * The way back from an endless station.
 *
 * A tune goes by, you think "what *was* that", and it is gone: Liked Tunes only holds what you
 * reacted to in time, and the playlist has already moved on. This keeps just enough to answer the
 * question, and no more — past a couple of dozen it would stop being a way back and start being a
 * second playlist.
 */

const entry = (path: string, playedAt = 1) =>
  toRecentlyPlayedEntry({ virtualPath: path, title: path.split("/").pop() ?? path, playedAt });

describe("withRecentlyPlayed", () => {
  it("puts the newest first", () => {
    const list = withRecentlyPlayed([entry("/a.sid")], entry("/b.sid"));
    expect(list.map((item) => item.virtualPath)).toEqual(["/b.sid", "/a.sid"]);
  });

  it("moves a tune heard again to the top rather than listing it twice", () => {
    // The question this answers is "what was that", and the same tune is the same answer however
    // many times it has come round.
    const list = withRecentlyPlayed([entry("/a.sid"), entry("/b.sid")], entry("/b.sid", 2));

    expect(list.map((item) => item.virtualPath)).toEqual(["/b.sid", "/a.sid"]);
    expect(list).toHaveLength(2);
  });

  it("keeps only the most recent, so the list stays scannable", () => {
    let list = [entry("/seed.sid")];
    for (let index = 0; index < RECENTLY_PLAYED_LIMIT + 10; index += 1) {
      list = withRecentlyPlayed(list, entry(`/tune-${index}.sid`));
    }

    expect(list).toHaveLength(RECENTLY_PLAYED_LIMIT);
    expect(list[0]?.virtualPath).toBe(`/tune-${RECENTLY_PLAYED_LIMIT + 9}.sid`);
    expect(list.some((item) => item.virtualPath === "/seed.sid")).toBe(false);
  });

  it("does not mutate the list it was given", () => {
    const original = [entry("/a.sid")];
    withRecentlyPlayed(original, entry("/b.sid"));
    expect(original).toHaveLength(1);
  });
});

describe("toRecentlyPlayedEntry", () => {
  it("says which folder the tune came from, as the search results do", () => {
    expect(
      toRecentlyPlayedEntry({ virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", title: "Commando" }),
    ).toMatchObject({ folder: "/MUSICIANS/H/Hubbard_Rob" });
  });

  it("handles a tune at the root", () => {
    expect(toRecentlyPlayedEntry({ virtualPath: "/loose.sid", title: "Loose" }).folder).toBe("/");
  });

  it("omits what it does not know rather than inventing it", () => {
    const built = toRecentlyPlayedEntry({ virtualPath: "/a.sid", title: "A" });
    expect(built.author).toBeNull();
    expect(built).not.toHaveProperty("durationMs");
    expect(built).not.toHaveProperty("songNr");
  });

  it("carries the subsong and duration when they are known", () => {
    const built = toRecentlyPlayedEntry({
      virtualPath: "/a.sid",
      title: "A",
      songNr: 3,
      subsongCount: 9,
      durationMs: 221_000,
    });
    expect(built).toMatchObject({ songNr: 3, subsongCount: 9, durationMs: 221_000 });
  });
});

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("round-trips", () => {
    saveRecentlyPlayed([entry("/a.sid"), entry("/b.sid")]);
    expect(loadRecentlyPlayed().map((item) => item.virtualPath)).toEqual(["/a.sid", "/b.sid"]);
  });

  it("starts empty", () => {
    expect(loadRecentlyPlayed()).toEqual([]);
  });

  it("survives a stored value that is not a list", () => {
    localStorage.setItem("c64u_recently_played:v1", '{"not":"an array"}');
    expect(loadRecentlyPlayed()).toEqual([]);
  });

  it("survives unparseable storage", () => {
    localStorage.setItem("c64u_recently_played:v1", "{{{");
    expect(loadRecentlyPlayed()).toEqual([]);
  });

  it("drops a malformed row rather than the whole list with it", () => {
    // Read at startup, so one bad row from an older build must not cost the rest.
    localStorage.setItem("c64u_recently_played:v1", JSON.stringify([{ nonsense: true }, entry("/good.sid")]));
    expect(loadRecentlyPlayed().map((item) => item.virtualPath)).toEqual(["/good.sid"]);
  });

  it("clears", () => {
    saveRecentlyPlayed([entry("/a.sid")]);
    clearRecentlyPlayed();
    expect(loadRecentlyPlayed()).toEqual([]);
  });
});
