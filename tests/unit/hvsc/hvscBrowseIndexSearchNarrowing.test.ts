/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHvscDisplayTitle,
  noteHvscBrowseSongsChanged,
  updateHvscBrowseSong,
  type HvscBrowseIndexSnapshot,
} from "@/lib/hvsc/hvscBrowseIndexStore";
import {
  getHvscSearchDiagnosticsForTests,
  searchSongsFromBrowseIndex,
  searchSongsFromBrowseIndexInSlices,
} from "@/lib/hvsc/hvscSongSearch";

const TITLES = [
  "Road Runner",
  "Roadblaster",
  "Rambo",
  "Hubbard Medley",
  "Robocop",
  "Comic Bakery",
  "Rob Hubbard Tribute",
];

const buildSnapshot = (): HvscBrowseIndexSnapshot => {
  const songs: HvscBrowseIndexSnapshot["songs"] = {};
  TITLES.forEach((title, index) => {
    const virtualPath = `/MUSICIANS/X/Composer_${index}/${title.replace(/ /g, "_")}.sid`;
    songs[virtualPath] = {
      virtualPath,
      fileName: `${title.replace(/ /g, "_")}.sid`,
      displayTitleSeed: title,
      displayAuthorSeed: `Composer ${index}`,
      searchTextSeed: `${title} composer ${index} ${virtualPath}`.toLowerCase(),
    };
  });
  return { schemaVersion: 1, updatedAt: "", songs, folders: {} } as unknown as HvscBrowseIndexSnapshot;
};

const titles = (snapshot: HvscBrowseIndexSnapshot, query: string) =>
  searchSongsFromBrowseIndex(snapshot, query, { limit: 100 }).songs.map((song) => getHvscDisplayTitle(song));

describe("HVSC search narrowing", () => {
  it("scans only the previous matches when a letter is typed on, with the same results as a full scan", () => {
    const snapshot = buildSnapshot();
    titles(snapshot, "ro");
    expect(getHvscSearchDiagnosticsForTests().scannedSongs).toBe(TITLES.length);
    const narrowed = titles(snapshot, "roa");

    expect(getHvscSearchDiagnosticsForTests().scannedSongs).toBe(4);
    expect(narrowed).toEqual(titles(buildSnapshot(), "roa"));
    expect(narrowed).toEqual(["Road Runner", "Roadblaster"]);
  });

  it("narrows from an earlier search when a multi-tap letter is replaced in place", () => {
    const snapshot = buildSnapshot();
    titles(snapshot, "ro");
    titles(snapshot, "rob");
    titles(snapshot, "roc");

    // "roc" does not extend "rob", but it does extend "ro".
    expect(getHvscSearchDiagnosticsForTests().scannedSongs).toBe(4);
  });

  it("scans everything again for a query that is not a narrowing of an earlier one", () => {
    const snapshot = buildSnapshot();
    titles(snapshot, "roa");
    titles(snapshot, "hub");

    expect(getHvscSearchDiagnosticsForTests().scannedSongs).toBe(TITLES.length);
  });

  it("does not narrow from matches held before the songs changed", () => {
    const snapshot = buildSnapshot();
    titles(snapshot, "rambo");
    const path = Object.keys(snapshot.songs).find((key) => key.includes("Comic"))!;
    updateHvscBrowseSong(snapshot, path, { canonicalTitle: "Rambo II" });

    expect(titles(snapshot, "rambo")).toEqual(["Rambo", "Rambo II"]);
    expect(getHvscSearchDiagnosticsForTests().scannedSongs).toBe(TITLES.length);
  });

  it("does not narrow after a song is added in place", () => {
    const snapshot = buildSnapshot();
    titles(snapshot, "zork");
    const virtualPath = "/MUSICIANS/X/New/Zork.sid";
    snapshot.songs[virtualPath] = {
      virtualPath,
      fileName: "Zork.sid",
      displayTitleSeed: "Zork",
      searchTextSeed: "zork",
    };
    noteHvscBrowseSongsChanged(snapshot);

    expect(titles(snapshot, "zork")).toEqual(["Zork"]);
  });
});

const bigSnapshot = (count: number): HvscBrowseIndexSnapshot => {
  const songs: HvscBrowseIndexSnapshot["songs"] = {};
  for (let index = 0; index < count; index += 1) {
    const virtualPath = `/MUSICIANS/X/Composer/Tune_${index}.sid`;
    songs[virtualPath] = {
      virtualPath,
      fileName: `Tune_${index}.sid`,
      displayTitleSeed: `Tune ${index}`,
      searchTextSeed: `tune ${index} ${virtualPath}`.toLowerCase(),
    };
  }
  return { schemaVersion: 1, updatedAt: "", songs, folders: {} } as unknown as HvscBrowseIndexSnapshot;
};

describe("HVSC search in slices", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives the main thread back between slices and answers as the one-piece search does", async () => {
    // Every clock read is 5 ms later, so each slice ends after a few hundred songs.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 5));
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const snapshot = bigSnapshot(3000);

    const sliced = await searchSongsFromBrowseIndexInSlices(snapshot, "tune 1", { limit: 20 });
    const yields = timeout.mock.calls.length;

    expect(yields).toBeGreaterThanOrEqual(4);
    expect(sliced).toEqual(searchSongsFromBrowseIndex(bigSnapshot(3000), "tune 1", { limit: 20 }));
  });

  it("rejects an already-aborted search before it scans or caches any songs", async () => {
    const snapshot = buildSnapshot();
    const controller = new AbortController();
    controller.abort(new Error("closed before the browse index loaded"));
    await expect(searchSongsFromBrowseIndexInSlices(snapshot, "ro", { signal: controller.signal })).rejects.toThrow(
      "closed before the browse index loaded",
    );
    expect(Object.values(snapshot.songs).every((song) => !("__foldedSearchText" in song))).toBe(true);
  });

  it("stops between slices once the search is no longer wanted", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 5));
    const controller = new AbortController();
    const search = searchSongsFromBrowseIndexInSlices(bigSnapshot(3000), "tune", { signal: controller.signal });
    controller.abort(new Error("superseded"));

    await expect(search).rejects.toThrow("superseded");
  });
});
