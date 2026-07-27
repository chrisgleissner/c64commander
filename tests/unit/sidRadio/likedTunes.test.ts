/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { buildLikedTunePlaylistItems, listLikedTunes } from "@/lib/sidRadio/likedTunes";
import { clearAllRankings, setRanking } from "@/lib/sidRadio/rankingStore";
import { rebuildMd548PathIndex, resetMd548PathIndex } from "@/lib/sidRadio/md5PathIndex";

// Full MD5s whose first 12 hex form the md5_48 the index resolves.
const COMMANDO = "aabbccddeeff00112233445566778899";
const ZOIDS = "112233445566778899aabbccddeeff00";
const REMOVED = "ffffffffffff00000000000000000000"; // md5_48 not in the index

const SONGLENGTHS = [
  "; /MUSICIANS/H/Hubbard_Rob/Commando.sid",
  `${COMMANDO}=3:41`,
  "; /MUSICIANS/D/Daglish_Ben/Zoids.sid",
  `${ZOIDS}=2:10`,
].join("\n");

beforeEach(async () => {
  localStorage.clear();
  resetMd548PathIndex();
  await clearAllRankings();
  rebuildMd548PathIndex(SONGLENGTHS, { force: true });
});

describe("likedTunes", () => {
  it("materialises liked full-MD5s into resolved HVSC entries", async () => {
    await setRanking(COMMANDO, "like");
    await setRanking(ZOIDS, "like");
    const entries = listLikedTunes();
    expect(entries.map((e) => e.label)).toEqual(["Commando.sid", "Zoids.sid"]);
    expect(entries.every((e) => e.resolved)).toBe(true);
    expect(entries[0].virtualPath).toBe("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
  });

  it("excludes not-for-me tunes", async () => {
    await setRanking(COMMANDO, "like");
    await setRanking(ZOIDS, "notForMe");
    expect(listLikedTunes().map((e) => e.md5)).toEqual([COMMANDO]);
  });

  it("greys a liked tune that no longer resolves (removed by an HVSC update, §2.5)", async () => {
    await setRanking(COMMANDO, "like");
    await setRanking(REMOVED, "like");
    const entries = listLikedTunes();
    const removed = entries.find((e) => e.md5 === REMOVED)!;
    expect(removed.resolved).toBe(false);
    expect(removed.virtualPath).toBeNull();
    expect(removed.label).toContain("Unknown tune");
  });

  it("builds playable HVSC PlaylistItems for resolved tunes only", async () => {
    await setRanking(COMMANDO, "like");
    await setRanking(REMOVED, "like");
    const items = buildLikedTunePlaylistItems(listLikedTunes());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      request: { source: "hvsc", path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid" },
      category: "sid",
      label: "Commando.sid",
      path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
    });
  });

  it("prefers an installed path via the resolver option (D14)", async () => {
    resetMd548PathIndex();
    rebuildMd548PathIndex(["; /A/dup.sid\n" + `${COMMANDO}=1:00`, "; /B/dup.sid\n" + `${COMMANDO}=1:00`], {
      force: true,
    });
    await setRanking(COMMANDO, "like");
    const installedOnly = listLikedTunes({ isInstalled: (p) => p.startsWith("/B/") });
    expect(installedOnly[0].virtualPath).toBe("/B/dup.sid");
  });
});
