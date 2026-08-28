/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { TIER1_SOURCES, likedTuneEntries, recentlyPlayedEntries } from "@/lib/search/tier1";
import { getSearchEntries, registerSearchEntries, resetSearchRegistryForTests } from "@/lib/search/registry";
import { saveRecentlyPlayed, toRecentlyPlayedEntry } from "@/lib/sidRadio/recentlyPlayed";

/*
 * Tier 1 is what THIS installation knows about, and it is the half of the index that a build cannot
 * contain. Before this existed the registry only ever held the generated entries, so a saved
 * machine, a liked tune and anything recently opened were all unfindable by name.
 */
describe("tier 1", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSearchRegistryForTests();
  });

  it("names every source it registers under, and every one produces entries of the declared shape", () => {
    expect(Object.keys(TIER1_SOURCES)).toEqual(["tier1.savedDevices", "tier1.likedTunes", "tier1.recentlyPlayed"]);
    for (const build of Object.values(TIER1_SOURCES)) {
      for (const entry of build()) {
        expect(entry.id).not.toBe("");
        expect(entry.titleDefault).not.toBe("");
        expect(entry.target).toBeDefined();
      }
    }
  });

  it("offers what was recently opened, and reaches the list that holds it", () => {
    saveRecentlyPlayed([
      toRecentlyPlayedEntry({
        virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
        title: "Commando",
        author: "Rob Hubbard",
        songNr: 1,
        subsongCount: 1,
        durationMs: 200_000,
      }),
    ]);

    const entries = recentlyPlayedEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].titleDefault).toBe("Commando");
    expect(entries[0].subtitleDefault).toBe("Rob Hubbard");
    expect(entries[0].target).toEqual({ kind: "action", handlerId: "openRecentlyPlayed" });
  });

  // Without a resolvable path the row would read "Unknown tune (a1b2c3)", which names nothing.
  it("leaves out a liked tune whose path cannot be resolved", () => {
    expect(likedTuneEntries().every((entry) => !entry.titleDefault.startsWith("Unknown tune"))).toBe(true);
  });

  it("reaches the registry, so the search can score it beside the generated entries", () => {
    const before = getSearchEntries().length;
    saveRecentlyPlayed([
      toRecentlyPlayedEntry({
        virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
        title: "Commando",
        author: "Rob Hubbard",
        songNr: 1,
        subsongCount: 1,
        durationMs: 200_000,
      }),
    ]);

    registerSearchEntries("tier1.recentlyPlayed", recentlyPlayedEntries());

    const after = getSearchEntries();
    expect(after.length).toBe(before + 1);
    expect(after.some((entry) => entry.titleDefault === "Commando")).toBe(true);
  });
});
