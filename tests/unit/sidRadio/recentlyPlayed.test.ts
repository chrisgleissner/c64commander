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

describe("v1 to v2 migration", () => {
  /*
   * A real v1 payload: no `category`, because v1 held HVSC tunes and nothing else. The Home Recent
   * tile lists disks and programs too, so every migrated row has to become a tune explicitly rather
   * than by the reader assuming what an absent field meant.
   */
  const V1_PAYLOAD = [
    {
      virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
      title: "Commando",
      author: "Rob Hubbard",
      folder: "/MUSICIANS/H/Hubbard_Rob",
      songNr: 1,
      subsongCount: 3,
      durationMs: 214000,
      playedAt: 1735689600000,
    },
    {
      virtualPath: "/MUSICIANS/G/Galway_Martin/Wizball.sid",
      title: "Wizball",
      author: "Martin Galway",
      folder: "/MUSICIANS/G/Galway_Martin",
      playedAt: 1735689500000,
    },
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  it("reads a v1 payload once and writes it back as v2 with category sid", () => {
    localStorage.setItem("c64u_recently_played:v1", JSON.stringify(V1_PAYLOAD));

    const migrated = loadRecentlyPlayed();

    expect(migrated).toHaveLength(2);
    expect(migrated.map((entry) => entry.category)).toEqual(["sid", "sid"]);
    expect(migrated[0]).toMatchObject({
      virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
      title: "Commando",
      author: "Rob Hubbard",
      songNr: 1,
      subsongCount: 3,
      durationMs: 214000,
      playedAt: 1735689600000,
    });
    expect(JSON.parse(localStorage.getItem("c64u_recently_played:v2") ?? "[]")).toHaveLength(2);
  });

  it("removes the v1 key, so a row removed after the migration cannot come back", () => {
    localStorage.setItem("c64u_recently_played:v1", JSON.stringify(V1_PAYLOAD));
    loadRecentlyPlayed();
    expect(localStorage.getItem("c64u_recently_played:v1")).toBeNull();

    saveRecentlyPlayed([]);
    expect(loadRecentlyPlayed()).toEqual([]);
  });

  it("leaves an existing v2 list alone rather than re-importing v1 over it", () => {
    localStorage.setItem("c64u_recently_played:v1", JSON.stringify(V1_PAYLOAD));
    localStorage.setItem(
      "c64u_recently_played:v2",
      JSON.stringify([
        {
          virtualPath: "/local/game.d64",
          title: "Game",
          author: null,
          folder: "/local",
          category: "disk",
          playedAt: 1,
        },
      ]),
    );

    const loaded = loadRecentlyPlayed();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].category).toBe("disk");
  });

  it("carries a disk and a program through unchanged", () => {
    saveRecentlyPlayed([
      toRecentlyPlayedEntry({ virtualPath: "/local/game.d64", title: "Game", category: "disk", sourceId: "local" }),
      toRecentlyPlayedEntry({ virtualPath: "/local/tool.prg", title: "Tool", category: "program" }),
    ]);

    expect(loadRecentlyPlayed().map((entry) => entry.category)).toEqual(["disk", "program"]);
    expect(loadRecentlyPlayed()[0].sourceId).toBe("local");
  });

  it("defaults an entry built with no category to a tune", () => {
    expect(toRecentlyPlayedEntry({ virtualPath: "/a/b.sid", title: "B" }).category).toBe("sid");
  });

  it("drops a malformed row without taking the list with it", () => {
    localStorage.setItem(
      "c64u_recently_played:v2",
      JSON.stringify([{ nope: true }, null, { virtualPath: "/a/b.sid", title: "B", playedAt: 5 }]),
    );
    expect(loadRecentlyPlayed().map((entry) => entry.virtualPath)).toEqual(["/a/b.sid"]);
  });
});

/*
 * A disk or a program is reopened by its source path, and the router dispatches on the source KIND.
 * Storing the id alone left a row that could be listed and not opened; storing the kind alone could
 * not say which of several configured local roots the path belongs to.
 */
describe("where a non-archive row came from", () => {
  it("keeps both the source kind and the source id", () => {
    const entry = toRecentlyPlayedEntry({
      virtualPath: "/Games/Elite.d64",
      title: "Elite",
      category: "disk",
      source: "local",
      sourceId: "local-source-2",
    });

    expect(entry.source).toBe("local");
    expect(entry.sourceId).toBe("local-source-2");

    saveRecentlyPlayed([entry]);
    const [readBack] = loadRecentlyPlayed();
    expect(readBack.source).toBe("local");
    expect(readBack.sourceId).toBe("local-source-2");
  });
});
