/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const readCounts = new Map<string, number>();

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  writeStilFile: vi.fn(async (name: string, text: string) => {
    files.set(name, text);
  }),
  readStilFile: vi.fn(async (name: string) => {
    readCounts.set(name, (readCounts.get(name) ?? 0) + 1);
    return files.get(name) ?? null;
  }),
  resetStilStore: vi.fn(async () => {
    files.clear();
  }),
}));

import {
  __resetStilStoreCachesForTest,
  clearStil,
  getStilEntry,
  getStilInfo,
  isStilInstalled,
  shardForPath,
  STIL_SHARD_COUNT,
  writeStilShards,
} from "@/lib/hvsc/stilStore";
import { parseStil } from "@/lib/hvsc/stilParser";

const DOCUMENT = `/MUSICIANS/H/Hubbard_Rob/Commando.sid
COMMENT: An arrangement of the arcade score.
(#1)
  TITLE: BGM1
 ARTIST: Tamayo Kawamoto

/MUSICIANS/G/Gray_Matt/Last_Ninja_2.sid
  TITLE: Central Park
 ARTIST: Matt Gray
`;

const seed = async () => {
  await writeStilShards(parseStil(DOCUMENT), 84);
  __resetStilStoreCachesForTest();
  readCounts.clear();
};

describe("stilStore", () => {
  beforeEach(async () => {
    files.clear();
    readCounts.clear();
    __resetStilStoreCachesForTest();
  });

  it("writes every shard plus a manifest, so a path always has a file to land in", async () => {
    await writeStilShards(parseStil(DOCUMENT), 84);
    expect(files.size).toBe(STIL_SHARD_COUNT + 1);
    expect(JSON.parse(files.get("index.json")!)).toMatchObject({ entries: 2, release: 84, shards: STIL_SHARD_COUNT });
  });

  it("round-trips an entry through the shard it hashes to", async () => {
    await seed();
    const entry = await getStilEntry("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    expect(entry?.comment).toBe("An arrangement of the arcade score.");
    expect(entry?.subsongs?.[1]?.credits?.[0]?.artist).toBe("Tamayo Kawamoto");
  });

  it("reads one shard per lookup and caches it", async () => {
    await seed();
    const path = "/MUSICIANS/H/Hubbard_Rob/Commando.sid";
    const shardFile = `shard-${shardForPath(path)}.json`;
    await getStilEntry(path);
    await getStilEntry(path);
    // index.json is read once to answer "is there anything installed"; the shard once, then cached.
    expect(readCounts.get(shardFile)).toBe(1);
  });

  it("does not read the same shard twice when two lookups race", async () => {
    await seed();
    const path = "/MUSICIANS/H/Hubbard_Rob/Commando.sid";
    const shardFile = `shard-${shardForPath(path)}.json`;
    await Promise.all([getStilEntry(path), getStilEntry(path), getStilEntry(path)]);
    expect(readCounts.get(shardFile)).toBe(1);
  });

  it("answers nothing for a file STIL does not describe, without inventing an entry", async () => {
    await seed();
    expect(await getStilEntry("/MUSICIANS/X/Nobody/Unknown.sid")).toBeNull();
  });

  it("reports nothing installed when the manifest is absent", async () => {
    expect(await isStilInstalled()).toBe(false);
    // And a lookup must not read shards to discover that.
    expect(await getStilEntry("/MUSICIANS/H/Hubbard_Rob/Commando.sid")).toBeNull();
    expect([...readCounts.keys()].filter((name) => name.startsWith("shard-"))).toEqual([]);
  });

  it("rejects a manifest written by a different store version", async () => {
    await writeStilShards(parseStil(DOCUMENT), 84);
    files.set("index.json", JSON.stringify({ version: 999, release: 84, entries: 2, shards: STIL_SHARD_COUNT }));
    __resetStilStoreCachesForTest();
    expect(await isStilInstalled()).toBe(false);
  });

  it("survives a corrupt shard rather than throwing at the caller", async () => {
    await seed();
    const path = "/MUSICIANS/H/Hubbard_Rob/Commando.sid";
    files.set(`shard-${shardForPath(path)}.json`, "{not json");
    __resetStilStoreCachesForTest();
    expect(await getStilEntry(path)).toBeNull();
  });

  it("falls back to the file's own information for a tune with no block", async () => {
    await seed();
    const info = await getStilInfo("/MUSICIANS/H/Hubbard_Rob/Commando.sid", 4);
    expect(info?.comment).toBe("An arrangement of the arcade score.");
  });

  it("spreads entries across shards rather than piling them into one", () => {
    const paths = Array.from({ length: 2000 }, (_, index) => `/MUSICIANS/A/Artist_${index}/Tune_${index}.sid`);
    const used = new Set(paths.map(shardForPath));
    expect(used.size).toBe(STIL_SHARD_COUNT);
    expect(Math.max(...paths.map(shardForPath))).toBeLessThan(STIL_SHARD_COUNT);
  });

  it("hashes case-insensitively so a case difference cannot miss the shard", () => {
    expect(shardForPath("/MUSICIANS/H/Hubbard_Rob/Commando.sid")).toBe(
      shardForPath("/musicians/h/hubbard_rob/commando.SID"),
    );
  });

  /**
   * Landing in the right shard was only half of the case-insensitive lookup the hash was written
   * for. A shard is a plain object keyed by the path as STIL spells it, so the lookup inside it
   * still had to match exactly and a browse index that wrote `.SID` where STIL wrote `.sid` found
   * nothing — the tune showed no notes and no original composer, with no error anywhere.
   */
  it("finds an entry whose stored spelling differs only by case", async () => {
    await writeStilShards(parseStil(DOCUMENT), 84);
    const entry = await getStilEntry("/MUSICIANS/H/Hubbard_Rob/COMMANDO.SID");
    expect(entry?.comment).toContain("arrangement");
  });

  it("still prefers the exact spelling when both are present", async () => {
    await writeStilShards(
      new Map([
        ["/MUSICIANS/H/Hubbard_Rob/Commando.sid", { comment: "exact" }],
        ["/MUSICIANS/H/Hubbard_Rob/COMMANDO.SID", { comment: "folded" }],
      ]),
      84,
    );
    expect((await getStilEntry("/MUSICIANS/H/Hubbard_Rob/Commando.sid"))?.comment).toBe("exact");
  });
});

describe("clearing the store while a read is in flight", () => {
  beforeEach(async () => {
    files.clear();
    readCounts.clear();
    __resetStilStoreCachesForTest();
  });

  it("does not let a read that was already running repopulate the cache", async () => {
    // The read still resolves after the store is gone — the caller gets what was on disk when it
    // asked — but caching it would put a shard of a deleted library back into a cache that was
    // just emptied, where the next lookup would find it.
    await writeStilShards(parseStil(DOCUMENT), 84);
    __resetStilStoreCachesForTest();

    const path = "/MUSICIANS/H/Hubbard_Rob/Commando.sid";
    const inFlightRead = getStilEntry(path);
    await clearStil();
    await inFlightRead;

    // Nothing on disk, nothing cached: the next lookup has to come back empty.
    expect(await getStilEntry(path)).toBeNull();
  });
});
