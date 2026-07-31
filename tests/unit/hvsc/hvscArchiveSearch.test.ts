/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    stat: vi.fn(async () => ({ type: "file", size: 1 })),
    mkdir: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => {
      throw new Error("missing");
    }),
    writeFile: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import {
  __buildPersistedMediaIndexSnapshotForTest,
  __parseMediaIndexSnapshotForTest,
  buildHvscBrowseIndexFromEntries,
  foldForSearch,
  listFolderFromBrowseIndex,
  searchSongsFromBrowseIndex,
  updateHvscBrowseSong,
} from "@/lib/hvsc/hvscBrowseIndexStore";

/**
 * Finding a tune in HVSC.
 *
 * The archive is filed by composer, so browsing to a title you can name means already knowing who
 * wrote it. The folder-scoped filter that the picker used could therefore only ever narrow what was
 * already on screen — searching "Commando" from the root of the archive found nothing at all, and
 * from MUSICIANS found nothing, and only worked once you had drilled into Hubbard_Rob, at which
 * point you no longer needed to search.
 */

const library = () =>
  buildHvscBrowseIndexFromEntries([
    { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", type: "sid" },
    { path: "/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", name: "Monty_on_the_Run.sid", type: "sid" },
    { path: "/MUSICIANS/G/Galway_Martin/Wizball.sid", name: "Wizball.sid", type: "sid" },
    { path: "/MUSICIANS/D/Daglish_Ben/Commando_Remix.sid", name: "Commando_Remix.sid", type: "sid" },
    { path: "/DEMOS/A-F/Commando_Tribute.sid", name: "Commando_Tribute.sid", type: "sid" },
  ]);

describe("searchSongsFromBrowseIndex", () => {
  it("finds a tune anywhere in the archive, not only in one folder", () => {
    const page = searchSongsFromBrowseIndex(library(), "commando");

    expect(page.totalSongs).toBe(3);
    expect(page.songs.map((song) => song.virtualPath)).toEqual([
      "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
      "/MUSICIANS/D/Daglish_Ben/Commando_Remix.sid",
      "/DEMOS/A-F/Commando_Tribute.sid",
    ]);
  });

  it("finds a composer's work by name, however the folder spells it", () => {
    // The folder is "Hubbard_Rob"; nobody types that. The seeded author reverses the underscored
    // segments, so "rob hubbard" has to work.
    const page = searchSongsFromBrowseIndex(library(), "rob hubbard");

    expect(page.songs.map((song) => song.fileName).sort()).toEqual(["Commando.sid", "Monty_on_the_Run.sid"]);
  });

  it("combines tokens with AND, so adding a word narrows the result", () => {
    const page = searchSongsFromBrowseIndex(library(), "hubbard commando");

    expect(page.songs.map((song) => song.virtualPath)).toEqual(["/MUSICIANS/H/Hubbard_Rob/Commando.sid"]);
  });

  it("puts the tune actually called Commando above the ones that merely mention it", () => {
    const page = searchSongsFromBrowseIndex(library(), "commando");

    expect(page.songs[0]?.fileName).toBe("Commando.sid");
  });

  it("can be restricted to a subtree", () => {
    const page = searchSongsFromBrowseIndex(library(), "commando", { path: "/MUSICIANS" });

    expect(page.songs.map((song) => song.virtualPath)).toEqual([
      "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
      "/MUSICIANS/D/Daglish_Ben/Commando_Remix.sid",
    ]);
  });

  it("pages, and reports the total behind the page", () => {
    const first = searchSongsFromBrowseIndex(library(), "commando", { limit: 2 });
    expect(first.songs).toHaveLength(2);
    expect(first.totalSongs).toBe(3);

    const second = searchSongsFromBrowseIndex(library(), "commando", { offset: 2, limit: 2 });
    expect(second.songs.map((song) => song.fileName)).toEqual(["Commando_Tribute.sid"]);
  });

  it("returns nothing for an empty query rather than the whole archive", () => {
    expect(searchSongsFromBrowseIndex(library(), "   ").totalSongs).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(searchSongsFromBrowseIndex(library(), "WIZBALL").songs).toHaveLength(1);
  });
});

/**
 * What counts as a match.
 *
 * Measured on the Pixel 4 against the real archive before this: "öörni" found 55 tunes and "oorni"
 * found none; "Böhme" found one and "bohme" found none. Every accented character on an Android
 * keyboard is behind a long-press, and HVSC is full of Scandinavian and German composer names, so a
 * search that insists on them cannot find a composer by name — which is what the search is for.
 */
describe("what a query matches", () => {
  const accented = () =>
    buildHvscBrowseIndexFromEntries([
      { path: "/MUSICIANS/C/Cadaver/Aces_High.sid", name: "Aces_High.sid", type: "sid" },
      { path: "/GAMES/S-Z/UFF.sid", name: "UFF.sid", type: "sid" },
    ]);

  const withAuthor = (author: string, virtualPath: string) => {
    const snapshot = accented();
    updateHvscBrowseSong(snapshot, virtualPath, { canonicalAuthor: author });
    return snapshot;
  };

  it("matches inside a word, not only at its start", () => {
    const page = searchSongsFromBrowseIndex(library(), "mando");

    expect(page.songs.map((song) => song.fileName)).toContain("Commando.sid");
  });

  it("ignores case on both sides", () => {
    expect(searchSongsFromBrowseIndex(library(), "CoMmAnDo").totalSongs).toBe(
      searchSongsFromBrowseIndex(library(), "commando").totalSongs,
    );
  });

  it("finds an accented composer typed without the accents", () => {
    const snapshot = withAuthor("Lasse Öörni", "/MUSICIANS/C/Cadaver/Aces_High.sid");

    expect(searchSongsFromBrowseIndex(snapshot, "oorni").totalSongs).toBe(1);
  });

  it("still finds them when the accents are typed", () => {
    const snapshot = withAuthor("Lasse Öörni", "/MUSICIANS/C/Cadaver/Aces_High.sid");

    expect(searchSongsFromBrowseIndex(snapshot, "öörni").totalSongs).toBe(1);
  });

  it("folds accents inside a word too", () => {
    const snapshot = withAuthor("Rainer Böhme", "/GAMES/S-Z/UFF.sid");

    expect(searchSongsFromBrowseIndex(snapshot, "ohm").totalSongs).toBe(1);
  });

  it("leaves plain text untouched, so the fold cannot corrupt a match", () => {
    expect(foldForSearch("commando")).toBe("commando");
    expect(foldForSearch("Lasse Öörni".toLowerCase())).toBe("lasse oorni");
  });
});

/**
 * A song carrying nothing but its SID header.
 *
 * The ingestion path writes songs with `sidMetadata` and no precomputed search text. The folder
 * filter always fell back to those header fields; the archive search did not, so such a song was
 * findable in its own folder and invisible everywhere else. The two now read the same text.
 */
describe("a song with no precomputed search text", () => {
  const headerOnly = () => {
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/GAMES/A-F/x.sid", name: "x.sid", type: "sid" }]);
    const song = snapshot.songs["/GAMES/A-F/x.sid"]!;
    delete song.searchTextFull;
    delete song.searchTextSeed;
    song.sidMetadata = { name: "Zoolook", author: "Jean Michel Jarre" } as never;
    return snapshot;
  };

  it("is findable by its header title from anywhere in the archive", () => {
    expect(searchSongsFromBrowseIndex(headerOnly(), "zoolook").totalSongs).toBe(1);
  });

  it("is findable by its header author", () => {
    expect(searchSongsFromBrowseIndex(headerOnly(), "jarre").totalSongs).toBe(1);
  });

  it("agrees with the folder filter, which always could find it", () => {
    const snapshot = headerOnly();
    const folder = listFolderFromBrowseIndex(snapshot, "/GAMES/A-F", "zoolook", 0, 50);
    const archive = searchSongsFromBrowseIndex(snapshot, "zoolook");

    expect(folder.totalSongs).toBe(1);
    expect(archive.totalSongs).toBe(folder.totalSongs);
  });
});

/**
 * The two scopes must agree about what a query means.
 *
 * A person types words into one box and flips This folder / Everywhere. If one scope treats the text
 * as a single string and the other as separate words, the same text finds different things.
 */
describe("folder filtering and archive search agree", () => {
  it("combines words with AND in a folder, as the archive search does", () => {
    const snapshot = library();
    const page = listFolderFromBrowseIndex(snapshot, "/MUSICIANS/H/Hubbard_Rob", "hubbard commando", 0, 50);

    expect(page.songs.map((song) => song.fileName)).toEqual(["Commando.sid"]);
  });

  it("folds accents in a folder filter too", () => {
    const snapshot = library();
    updateHvscBrowseSong(snapshot, "/MUSICIANS/G/Galway_Martin/Wizball.sid", { canonicalAuthor: "Martin Gälway" });

    expect(listFolderFromBrowseIndex(snapshot, "/MUSICIANS/G/Galway_Martin", "galway", 0, 50).totalSongs).toBe(1);
  });
});

/**
 * What survives a restart on a real library.
 *
 * A real HVSC is ~60k songs, past the cap for persisting the full snapshot, so on a real install the
 * compact media index is the only thing that comes back. It carried path, name and duration and
 * nothing else — so every launch threw away metadata hydration's results and started it over. Two
 * consequences, both observed on the Pixel 4: the archive search could only find composers by the
 * name spelled in their folder path ("Cadaver" rather than "Lasse Öörni"), and the phone re-read
 * every SID in the archive on every cold start.
 */
describe("hydrated metadata survives a restart", () => {
  const hydratedSnapshot = () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/MUSICIANS/C/Cadaver/Aces_High.sid", name: "Aces_High.sid", type: "sid", durationSeconds: 120 },
      { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", type: "sid" },
    ]);
    updateHvscBrowseSong(snapshot, "/MUSICIANS/C/Cadaver/Aces_High.sid", {
      canonicalTitle: "Aces High",
      canonicalAuthor: "Lasse Öörni",
      released: "1996 Cadaver",
      metadataStatus: "hydrated",
    });
    return snapshot;
  };

  /** Round-trip through the compact form, as a restart does. */
  const reload = (snapshot: ReturnType<typeof hydratedSnapshot>) =>
    __parseMediaIndexSnapshotForTest(JSON.stringify(__buildPersistedMediaIndexSnapshotForTest(snapshot)));

  it("brings the canonical composer back", () => {
    const reloaded = reload(hydratedSnapshot())!;

    expect(reloaded.songs["/MUSICIANS/C/Cadaver/Aces_High.sid"]?.canonicalAuthor).toBe("Lasse Öörni");
  });

  it("keeps the tune findable by that composer after the restart", () => {
    const reloaded = reload(hydratedSnapshot())!;

    expect(searchSongsFromBrowseIndex(reloaded, "oorni").totalSongs).toBe(1);
    expect(searchSongsFromBrowseIndex(reloaded, "lasse").totalSongs).toBe(1);
  });

  it("remembers that the song was hydrated, so the archive is not read again on every launch", () => {
    const reloaded = reload(hydratedSnapshot())!;

    expect(reloaded.songs["/MUSICIANS/C/Cadaver/Aces_High.sid"]?.metadataStatus).toBe("hydrated");
    // And a song hydration never reached stays pending, so it is still queued.
    expect(reloaded.songs["/MUSICIANS/H/Hubbard_Rob/Commando.sid"]?.metadataStatus).not.toBe("hydrated");
  });

  it("brings back how many tunes a file holds", () => {
    // The count lives in the SID header, not in the index, so losing it left every multi-tune file
    // looking like a single track after a restart: no "Tune 3 of 19" on the card, no subsong
    // selector, and nothing to offer to play them all.
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", name: "Monty_on_the_Run.sid", type: "sid" },
    ]);
    updateHvscBrowseSong(snapshot, "/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", {
      durationsSeconds: [350, 61, 44, 32, 120],
    });

    const reloaded = reload(snapshot)!;
    const song = reloaded.songs["/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid"];

    expect(song?.subsongCount).toBe(5);
    expect(song?.durationsSeconds).toEqual([350, 61, 44, 32, 120]);
    expect(song?.trackSubsongs?.map((tune) => tune.songNr)).toEqual([1, 2, 3, 4, 5]);
  });

  it("writes nothing extra for a single-tune file, which is most of them", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/A/one.sid", name: "one.sid", type: "sid", durationSeconds: 61 },
    ]);
    const entry = __buildPersistedMediaIndexSnapshotForTest(snapshot).entries[0]!;

    expect(entry).not.toHaveProperty("durations");
  });

  it("writes nothing extra for a library that has not been hydrated", () => {
    const plain = buildHvscBrowseIndexFromEntries([{ path: "/A/x.sid", name: "x.sid", type: "sid" }]);
    const entry = __buildPersistedMediaIndexSnapshotForTest(plain).entries[0]!;

    expect(entry).not.toHaveProperty("title");
    expect(entry).not.toHaveProperty("author");
    expect(entry).not.toHaveProperty("hydrated");
  });

  it("still reads a file written before any of this existed", () => {
    const legacy = JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ path: "/A/x.sid", name: "x.sid", type: "sid", durationSeconds: 61 }],
    });

    const reloaded = __parseMediaIndexSnapshotForTest(legacy)!;
    expect(reloaded.songs["/A/x.sid"]?.durationSeconds).toBe(61);
    expect(reloaded.songs["/A/x.sid"]?.metadataStatus).not.toBe("hydrated");
  });
});

/**
 * Ranking is bounded to the page being asked for.
 *
 * A one-letter query matches sixty thousand tunes and shows a hundred. Ordering all sixty thousand
 * to throw away 99.8% of the work was measured on a Pixel 4 as the dominant cost of a broad search,
 * and it is a synchronous block on the thread that also drives playback. The order it produces has
 * to be identical to a full sort, so this pins that rather than the mechanism.
 */
describe("bounded ranking", () => {
  const many = (count: number) =>
    buildHvscBrowseIndexFromEntries(
      Array.from({ length: count }, (_, index) => ({
        // Zero-padded so lexical and numeric order agree, and the expected order is obvious.
        path: `/DEMOS/Tune_${String(index).padStart(4, "0")}.sid`,
        name: `Tune_${String(index).padStart(4, "0")}.sid`,
        type: "sid" as const,
      })),
    );

  it("returns the same first page a full sort would", () => {
    const page = searchSongsFromBrowseIndex(many(500), "tune", { limit: 5 });

    expect(page.songs.map((song) => song.fileName)).toEqual([
      "Tune_0000.sid",
      "Tune_0001.sid",
      "Tune_0002.sid",
      "Tune_0003.sid",
      "Tune_0004.sid",
    ]);
  });

  it("counts every match even though it only ranks a page of them", () => {
    expect(searchSongsFromBrowseIndex(many(500), "tune", { limit: 5 }).totalSongs).toBe(500);
  });

  it("pages deeper without losing or repeating a result", () => {
    const size = 20;
    const seen: string[] = [];
    for (let offset = 0; offset < 100; offset += size) {
      const page = searchSongsFromBrowseIndex(many(100), "tune", { offset, limit: size });
      expect(page.songs).toHaveLength(size);
      seen.push(...page.songs.map((song) => song.virtualPath));
    }

    expect(new Set(seen).size).toBe(100);
    expect(seen[0]).toBe("/DEMOS/Tune_0000.sid");
    expect(seen[99]).toBe("/DEMOS/Tune_0099.sid");
  });

  it("keeps the best match first even when it is found last", () => {
    // The exact-title match is the very last row scanned, so a bounded selection that dropped it
    // early would silently rank the accidents above the obvious answer.
    const snapshot = buildHvscBrowseIndexFromEntries([
      ...Array.from({ length: 50 }, (_, index) => ({
        path: `/DEMOS/Zzz_Commando_Filler_${index}.sid`,
        name: `Zzz_Commando_Filler_${index}.sid`,
        type: "sid" as const,
      })),
      { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", type: "sid" as const },
    ]);

    const page = searchSongsFromBrowseIndex(snapshot, "commando", { limit: 3 });

    expect(page.songs[0]?.fileName).toBe("Commando.sid");
  });
});
