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
/**
 * Hold every shard read, or the next read or write of one named file, until the test lets it through.
 * A held read of a named file answers with what was on disk when it was asked.
 */
const gates: {
  shardReads: Promise<void> | null;
  reads: Map<string, Promise<void>>;
  writes: Map<string, Promise<void>>;
} = {
  shardReads: null,
  reads: new Map(),
  writes: new Map(),
};

const logs = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/logging", () => logs);

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  writeStilFile: vi.fn(async (name: string, text: string) => {
    const gate = gates.writes.get(name);
    gates.writes.delete(name);
    await gate;
    files.set(name, text);
  }),
  readStilFile: vi.fn(async (name: string) => {
    readCounts.set(name, (readCounts.get(name) ?? 0) + 1);
    const readGate = gates.reads.get(name);
    if (readGate) {
      gates.reads.delete(name);
      const text = files.get(name) ?? null;
      await readGate;
      return text;
    }
    if (name.startsWith("shard-") && gates.shardReads) await gates.shardReads;
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
  readStilCollections,
  readStilManifest,
  shardForPath,
  STIL_SHARD_COUNT,
  writeStilShards,
} from "@/lib/hvsc/stilStore";
import { parseStil } from "@/lib/hvsc/stilParser";
import { deriveStilCollections, STIL_COLLECTIONS_VERSION } from "@/lib/hvsc/stilCollections";
import { saveHvscState } from "@/lib/hvsc/hvscStateStore";
import { isStilFetchNeeded } from "@/lib/hvsc/stilService";

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

  it("writes every shard plus the collections and a manifest, so a path always has a file to land in", async () => {
    await writeStilShards(parseStil(DOCUMENT), 84);
    expect(files.size).toBe(STIL_SHARD_COUNT + 2);
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

const COLLECTION_DOCUMENT = `/MUSICIANS/C/Crowley_Owen/A_Drop_of_Blue.sid
COMMENT: Won the music competition at 15 Years Oxyron Party 2007

/MUSICIANS/D/DJ_Space/Moonlight_Sonata.sid
  TITLE: Piano Sonata No. 14 Op. 27 "Moonlight Sonata", 3rd Movement
 ARTIST: Ludwig van Beethoven
`;

const shardReads = () => [...readCounts.entries()].filter(([name]) => name.startsWith("shard-")).length;

describe("STIL collections", () => {
  beforeEach(() => {
    files.clear();
    readCounts.clear();
    logs.addLog.mockClear();
    logs.addErrorLog.mockClear();
    gates.shardReads = null;
    gates.reads.clear();
    gates.writes.clear();
    __resetStilStoreCachesForTest();
    delete (window as Window & { __stilMock__?: unknown }).__stilMock__;
  });

  it("stores the collections beside the shards and records their rules version in the manifest", async () => {
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 85);
    const manifest = JSON.parse(files.get("index.json")!);
    expect(manifest.collectionsVersion).toBe(STIL_COLLECTIONS_VERSION);
    expect(JSON.parse(files.get("collections.json")!).paths).toEqual([
      "/MUSICIANS/C/Crowley_Owen/A_Drop_of_Blue.sid",
      "/MUSICIANS/D/DJ_Space/Moonlight_Sonata.sid",
    ]);
  });

  it("reads the stored collections without touching a shard, and only once", async () => {
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 85);
    __resetStilStoreCachesForTest();
    readCounts.clear();
    const first = await readStilCollections();
    const second = await readStilCollections();
    expect(first?.collections.winners).toEqual([[0, 1]]);
    expect(second).toBe(first);
    expect(shardReads()).toBe(0);
    expect(readCounts.get("collections.json")).toBe(1);
  });

  it("derives the collections from the stored shards when the store predates them", async () => {
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 85);
    const legacy = JSON.parse(files.get("index.json")!);
    delete legacy.collectionsVersion;
    files.set("index.json", JSON.stringify(legacy));
    files.delete("collections.json");
    __resetStilStoreCachesForTest();

    const index = await readStilCollections();

    expect(index?.collections.classical).toEqual([[1, 1]]);
    expect(shardReads()).toBe(STIL_SHARD_COUNT);
    expect(files.has("collections.json")).toBe(true);
    expect(JSON.parse(files.get("index.json")!)).toMatchObject({
      release: 85,
      collectionsVersion: STIL_COLLECTIONS_VERSION,
    });
  });

  it("derives them again when the stored rules are older than this build's", async () => {
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 85);
    files.set(
      "collections.json",
      JSON.stringify({ version: STIL_COLLECTIONS_VERSION - 1, paths: [], collections: {} }),
    );
    __resetStilStoreCachesForTest();
    expect((await readStilCollections())?.collections.winners).toEqual([[0, 1]]);
  });

  it("derives them again, and says so, when the stored file is unreadable", async () => {
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 85);
    files.set("collections.json", "{not json");
    __resetStilStoreCachesForTest();
    expect((await readStilCollections())?.collections.winners).toEqual([[0, 1]]);
    expect(logs.addErrorLog).toHaveBeenCalledWith(
      "STIL collections are not readable; deriving them again",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("answers null when no STIL is stored", async () => {
    expect(await readStilCollections()).toBeNull();
  });

  it("derives the collections from STIL supplied by a test", async () => {
    (window as Window & { __stilMock__?: unknown }).__stilMock__ = Object.fromEntries(parseStil(COLLECTION_DOCUMENT));
    expect((await readStilCollections())?.collections.winners).toEqual([[0, 1]]);
    expect(readCounts.size).toBe(0);
  });

  it("forgets the collections when the store is cleared", async () => {
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 85);
    expect(await readStilCollections()).not.toBeNull();
    await clearStil();
    expect(await readStilCollections()).toBeNull();
  });

  it("reports a derivation it could not store and tries again on the next call", async () => {
    const filesystem = await import("@/lib/hvsc/hvscFilesystem");
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 85);
    files.delete("collections.json");
    const legacy = JSON.parse(files.get("index.json")!);
    delete legacy.collectionsVersion;
    files.set("index.json", JSON.stringify(legacy));
    __resetStilStoreCachesForTest();
    vi.mocked(filesystem.writeStilFile).mockRejectedValueOnce(new Error("disk full"));
    expect(await readStilCollections()).toBeNull();
    expect(logs.addErrorLog).toHaveBeenCalledWith("STIL collections could not be read", { error: "disk full" });
    expect((await readStilCollections())?.collections.winners).toEqual([[0, 1]]);
  });

  const NEWER_DOCUMENT = `/MUSICIANS/X/Xmas/Jingle.sid
  TITLE: Jingle Bells
 ARTIST: James Lord Pierpont
`;

  const storeWithoutCollections = async () => {
    await writeStilShards(parseStil(COLLECTION_DOCUMENT), 84);
    const legacy = JSON.parse(files.get("index.json")!);
    delete legacy.collectionsVersion;
    files.set("index.json", JSON.stringify(legacy));
    files.delete("collections.json");
    __resetStilStoreCachesForTest();
  };

  const deferred = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  it("does not write the previous release's manifest over a store that was replaced while it was read", async () => {
    await storeWithoutCollections();
    // The app read the manifest at startup, before a new release's STIL arrived.
    expect((await readStilManifest())?.release).toBe(84);

    const shardWrite = deferred();
    gates.writes.set("shard-0.json", shardWrite.promise);
    const ingest = writeStilShards(parseStil(NEWER_DOCUMENT), 85);
    await vi.waitFor(() => expect(files.has("index.json")).toBe(false));

    const shardReads = deferred();
    gates.shardReads = shardReads.promise;
    const launcherRead = readStilCollections();

    shardWrite.release();
    await ingest;
    shardReads.release();
    await launcherRead;

    expect(JSON.parse(files.get("index.json")!)).toMatchObject({ release: 85 });
    expect(JSON.parse(files.get("collections.json")!)).toEqual(deriveStilCollections(parseStil(NEWER_DOCUMENT)));
    expect((await readStilCollections())?.collections.christmas).toEqual([[0, 1]]);
  });

  it("discards a derivation whose store was replaced before it could be written", async () => {
    await storeWithoutCollections();
    const collectionsWrite = deferred();
    gates.writes.set("collections.json", collectionsWrite.promise);
    const launcherRead = readStilCollections();
    await vi.waitFor(() => expect(shardReads()).toBe(STIL_SHARD_COUNT));

    // The derivation is now waiting on its write while a new release's STIL is stored.
    const ingest = writeStilShards(parseStil(NEWER_DOCUMENT), 85);
    // Long enough for an unserialized ingestion to finish all 66 of its writes.
    for (let turn = 0; turn < 1000; turn += 1) await Promise.resolve();
    collectionsWrite.release();
    await Promise.all([launcherRead, ingest]);

    expect(JSON.parse(files.get("index.json")!)).toMatchObject({ release: 85 });
    expect(JSON.parse(files.get("collections.json")!)).toEqual(deriveStilCollections(parseStil(NEWER_DOCUMENT)));
  });

  it("removes a store that is missing a shard, so the next prepare downloads it again", async () => {
    saveHvscState({ installedVersion: 84, installedBaselineVersion: 84 } as never);
    await storeWithoutCollections();
    const missing = shardForPath("/MUSICIANS/D/DJ_Space/Moonlight_Sonata.sid");
    files.delete(`shard-${missing}.json`);
    expect(await isStilFetchNeeded()).toBe(false);

    expect(await readStilCollections()).toBeNull();
    expect(logs.addLog).toHaveBeenCalledWith(
      "warn",
      "STIL store is incomplete: a stored shard is missing or unreadable; removing it",
      { shard: missing, release: 84 },
    );
    expect(files.has("index.json")).toBe(false);
    expect(await isStilInstalled()).toBe(false);
    expect(await isStilFetchNeeded()).toBe(true);

    readCounts.clear();
    expect(await readStilCollections()).toBeNull();
    expect(shardReads()).toBe(0);
  });

  it("does not write a manifest read before the store was replaced over the new one", async () => {
    await storeWithoutCollections();
    const manifestRead = deferred();
    gates.reads.set("index.json", manifestRead.promise);
    const launcherRead = readStilCollections();
    await vi.waitFor(() => expect(readCounts.get("index.json")).toBe(1));

    await writeStilShards(parseStil(NEWER_DOCUMENT), 85);
    manifestRead.release();
    await launcherRead;

    expect(JSON.parse(files.get("index.json")!)).toMatchObject({ release: 85 });
  });

  it("discards a derivation that began during an ingestion that then failed", async () => {
    const filesystem = await import("@/lib/hvsc/hvscFilesystem");
    await storeWithoutCollections();
    const reset = deferred();
    vi.mocked(filesystem.resetStilStore).mockImplementationOnce(async () => {
      await reset.promise;
      files.clear();
    });
    const resetsBefore = vi.mocked(filesystem.resetStilStore).mock.calls.length;
    const ingest = writeStilShards(parseStil(NEWER_DOCUMENT), 85);
    // The ingestion has forgotten the previous store and is removing it when the launcher reads.
    await vi.waitFor(() => expect(filesystem.resetStilStore).toHaveBeenCalledTimes(resetsBefore + 1));
    const launcherRead = readStilCollections();
    await vi.waitFor(() => expect(shardReads()).toBe(STIL_SHARD_COUNT));

    vi.mocked(filesystem.writeStilFile).mockRejectedValueOnce(new Error("disk full"));
    reset.release();
    await expect(ingest).rejects.toThrow("disk full");

    expect(await launcherRead).toBeNull();
    expect(files.has("index.json")).toBe(false);
    expect(files.has("collections.json")).toBe(false);
  });

  it("discards a derivation when a store write queued ahead of it replaces the store", async () => {
    const filesystem = await import("@/lib/hvsc/hvscFilesystem");
    await storeWithoutCollections();
    const reset = deferred();
    vi.mocked(filesystem.resetStilStore).mockImplementationOnce(async () => {
      await reset.promise;
      files.clear();
    });
    const clearing = clearStil();
    const ingest = writeStilShards(parseStil(NEWER_DOCUMENT), 85);
    const launcherRead = readStilCollections();
    await vi.waitFor(() => expect(shardReads()).toBe(STIL_SHARD_COUNT));

    reset.release();
    await Promise.all([clearing, ingest]);

    expect(await launcherRead).toBeNull();
    expect(logs.addLog).toHaveBeenCalledWith(
      "info",
      "STIL collections derivation discarded: the store was replaced meanwhile",
      { release: 84 },
    );
    expect(JSON.parse(files.get("index.json")!)).toMatchObject({ release: 85 });
    expect(JSON.parse(files.get("collections.json")!)).toEqual(deriveStilCollections(parseStil(NEWER_DOCUMENT)));
  });
});
