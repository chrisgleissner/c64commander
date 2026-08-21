/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Where STIL is kept, and how one tune's worth of it is found again.
 *
 * Parsed in full, STIL is 3.79 MB of strings for 18,475 files. The app already holds a browse index
 * over 61,157 songs, so keeping a second structure of that size resident is not affordable on the
 * phones this runs on — and it would be wasted, because the questions asked of STIL are always
 * about one file: the tune playing now, or the file whose tunes were just expanded into the
 * playlist.
 *
 * So the parsed form is split across a fixed number of shards on disk, each a JSON object of
 * `{ path: entry }`. A lookup hashes the path, reads that one shard (median 58 KB, largest 76 KB)
 * and keeps a few of them in memory. Resident cost is bounded by the cache, not by the archive.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { readStilFile, resetStilStore, writeStilFile } from "./hvscFilesystem";
import { parseStil, stilInfoForSubsong, type StilEntry, type StilInfo } from "./stilParser";

/**
 * Chosen by measuring the real document: 64 shards give a median of 58 KB and a largest of 76 KB.
 * Fewer makes each read chunkier for no benefit; more multiplies the file count without making the
 * reads meaningfully cheaper, since the per-call bridge overhead stops being the smaller cost.
 */
export const STIL_SHARD_COUNT = 64;
const MANIFEST_NAME = "index.json";
/**
 * Bumped when the parsed shape changes, so a shard written by an older build is discarded rather
 * than read as though it were current.
 */
export const STIL_STORE_VERSION = 2;
/**
 * Enough to cover playing a file's tunes back to back and a station's jumps between composers,
 * without the cache itself becoming the memory problem the sharding avoids. Four shards is roughly
 * 240 KB.
 */
const SHARD_CACHE_LIMIT = 4;

export type StilManifest = {
  version: number;
  /** The HVSC release this was derived from, so an update can tell it is out of date. */
  release: number;
  entries: number;
  shards: number;
  updatedAt: number;
};

const shardName = (shard: number) => `shard-${shard}.json`;

/**
 * STIL supplied by a test.
 *
 * The real store is a set of files, and the only way to fill it is to download and parse 3.7 MB of
 * the archive — which a screenshot run has no business doing, and could not do offline anyway. A
 * test that wants a tune to have notes says so directly.
 *
 * Deliberately its own global rather than a field on `__hvscMock__`: the presence of that object is
 * what `isHvscBridgeAvailable` reads to decide the whole HVSC subsystem is mocked, so hanging STIL
 * off it would change which sources the app offers in captures that are about something else.
 */
const mockedStil = (): Record<string, StilEntry> | null => {
  if (typeof window === "undefined") return null;
  return (window as Window & { __stilMock__?: Record<string, StilEntry> }).__stilMock__ ?? null;
};

/**
 * FNV-1a over the lowercased path, finished with an avalanche step.
 *
 * Lowercased so that a path spelled differently by the archive listing and by STIL still lands in
 * the same shard — which is what makes {@link findInShard}'s fallback able to find it at all. That
 * is safe here: the real document has no two entries whose paths differ only by case, so the fold
 * cannot merge two distinct tunes.
 *
 * The avalanche is not decoration. FNV-1a's low bits mix poorly, and taking a shard number straight
 * from them means highly patterned inputs — which is exactly what these paths are, a fixed prefix
 * then a composer then `.sid` — leave whole shards empty. Measured on 2,000 paths of that shape it
 * filled 32 of the 64 shards and doubled the size of the rest. The finalizer (MurmurHash3's fmix32
 * tail) spreads the entropy down into the bits the modulo actually reads.
 */
export const shardForPath = (virtualPath: string): number => {
  const key = virtualPath.toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  return (hash >>> 0) % STIL_SHARD_COUNT;
};

type Shard = Record<string, StilEntry>;

/** Most-recently-used last. Small enough that an array beats a Map here. */
const shardCache: Array<{ shard: number; entries: Shard }> = [];
/**
 * Bumped whenever the store is replaced or removed.
 *
 * A read already in flight when that happens still resolves, and it would otherwise cache what it
 * read — putting a shard of a library that no longer exists back into a cache that was just
 * emptied. Dropping the in-flight map is not enough on its own, because the promise holds its own
 * reference to the work; the generation is what lets the read notice it has been overtaken.
 */
let storeGeneration = 0;
let manifestPromise: Promise<StilManifest | null> | null = null;
const inFlight = new Map<number, Promise<Shard | null>>();

const touch = (shard: number, entries: Shard) => {
  const existing = shardCache.findIndex((cached) => cached.shard === shard);
  if (existing >= 0) shardCache.splice(existing, 1);
  shardCache.push({ shard, entries });
  while (shardCache.length > SHARD_CACHE_LIMIT) shardCache.shift();
};

const readShard = async (shard: number): Promise<Shard | null> => {
  const cached = shardCache.find((entry) => entry.shard === shard);
  if (cached) {
    touch(shard, cached.entries);
    return cached.entries;
  }
  // Two tunes from the same shard asked for at once must not both read and parse it.
  const running = inFlight.get(shard);
  if (running) return running;

  const generation = storeGeneration;
  const load = (async (): Promise<Shard | null> => {
    const text = await readStilFile(shardName(shard));
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as Shard;
      // Read, but from a store that has since been replaced or removed. The caller gets what was on
      // disk when it asked; the cache does not, because caching it would resurrect it.
      if (generation === storeGeneration) touch(shard, parsed);
      return parsed;
    } catch (error) {
      addErrorLog("STIL shard is not readable", { shard, error: (error as Error).message });
      return null;
    }
  })().finally(() => {
    inFlight.delete(shard);
  });
  inFlight.set(shard, load);
  return load;
};

export const readStilManifest = async (): Promise<StilManifest | null> => {
  manifestPromise ??= (async () => {
    const text = await readStilFile(MANIFEST_NAME);
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as StilManifest;
      if (parsed.version !== STIL_STORE_VERSION || parsed.shards !== STIL_SHARD_COUNT) {
        // Written by an older build. Reported rather than swallowed: the next lookup will find
        // nothing, and "STIL is absent" and "STIL is stale" want different answers from whoever is
        // reading the log.
        addLog("info", "STIL store is from an older version; it will be rebuilt", {
          version: parsed.version,
          expectedVersion: STIL_STORE_VERSION,
          shards: parsed.shards,
        });
        return null;
      }
      return parsed;
    } catch (error) {
      addErrorLog("STIL manifest is not readable", { error: (error as Error).message });
      return null;
    }
  })();
  return manifestPromise;
};

/**
 * Whether a test has supplied STIL directly.
 *
 * Separate from `isStilInstalled` because the two answer different questions. This one means "do
 * not go near the network or the disk"; that one means "is there anything to look up", which is
 * also true of a stored copy that is out of date and ought to be refreshed.
 */
export const hasMockedStil = (): boolean => mockedStil() !== null;

/** Whether there is anything to look up, so callers can skip the work rather than miss repeatedly. */
export const isStilInstalled = async (): Promise<boolean> =>
  mockedStil() !== null || (await readStilManifest()) !== null;

/**
 * Write the parsed document out as shards.
 *
 * The manifest is written last so that a run interrupted part way through leaves the store looking
 * absent rather than looking complete while missing shards.
 */
export const writeStilShards = async (entries: Map<string, StilEntry>, release: number): Promise<void> => {
  const shards: Shard[] = Array.from({ length: STIL_SHARD_COUNT }, () => ({}));
  for (const [path, entry] of entries) {
    shards[shardForPath(path)][path] = entry;
  }
  await resetStilStore();
  storeGeneration += 1;
  inFlight.clear();
  for (let shard = 0; shard < STIL_SHARD_COUNT; shard += 1) {
    await writeStilFile(shardName(shard), JSON.stringify(shards[shard]));
  }
  const manifest: StilManifest = {
    version: STIL_STORE_VERSION,
    release,
    entries: entries.size,
    shards: STIL_SHARD_COUNT,
    updatedAt: Date.now(),
  };
  await writeStilFile(MANIFEST_NAME, JSON.stringify(manifest));
  manifestPromise = Promise.resolve(manifest);
  shardCache.length = 0;
  addLog("info", "STIL stored", { entries: entries.size, shards: STIL_SHARD_COUNT, release });
};

/** Parse a STIL document and store it, in one step. Returns how many files it described. */
export const ingestStilText = async (text: string, release: number): Promise<number> => {
  const entries = parseStil(text);
  if (entries.size === 0) {
    addLog("warn", "STIL document parsed to nothing; not storing", { length: text.length });
    return 0;
  }
  await writeStilShards(entries, release);
  return entries.size;
};

/**
 * Find a path in a shard, ignoring case when the exact spelling is not there.
 *
 * {@link shardForPath} hashes the lowercased path so a case difference between the archive listing
 * and STIL's own spelling still lands in the same shard. That was only half of it: the shard is a
 * plain object keyed by the path as written, so the lookup inside it still had to match exactly and
 * the fold bought nothing. STIL is a hand-maintained document and does write `.SID` in places.
 *
 * The scan runs only when the exact key misses, and a shard holds a few hundred entries, so a hit
 * costs one property read and a miss costs one pass over a shard already in memory. Deliberately
 * not a rebuild of the store into folded keys: that would make every installed library re-download
 * and re-parse 3.7 MB to fix a lookup that can be fixed here.
 */
const findInShard = (shard: Shard, virtualPath: string): StilEntry | null => {
  const exact = shard[virtualPath];
  if (exact) return exact;
  const folded = virtualPath.toLowerCase();
  for (const key of Object.keys(shard)) {
    if (key.toLowerCase() === folded) return shard[key];
  }
  return null;
};

/** Everything STIL says about one file, including its per-tune blocks. */
export const getStilEntry = async (virtualPath: string): Promise<StilEntry | null> => {
  if (!virtualPath) return null;
  const mock = mockedStil();
  if (mock) return findInShard(mock, virtualPath);
  if (!(await isStilInstalled())) return null;
  const shard = await readShard(shardForPath(virtualPath));
  return shard ? findInShard(shard, virtualPath) : null;
};

/** What STIL says about one tune, falling back to what it says about the file. */
export const getStilInfo = async (virtualPath: string, songNr?: number): Promise<StilInfo | null> => {
  const entry = await getStilEntry(virtualPath);
  return stilInfoForSubsong(entry ?? undefined, songNr) ?? null;
};

export const clearStil = async (): Promise<void> => {
  await resetStilStore();
  manifestPromise = null;
  shardCache.length = 0;
  // A read already in flight when the store was removed still resolves, and would otherwise cache
  // a shard of the library that has just been deleted.
  storeGeneration += 1;
  inFlight.clear();
};

/** Test seam: drops the in-memory caches without touching what is on disk. */
export const __resetStilStoreCachesForTest = () => {
  manifestPromise = null;
  shardCache.length = 0;
  storeGeneration += 1;
  inFlight.clear();
};
