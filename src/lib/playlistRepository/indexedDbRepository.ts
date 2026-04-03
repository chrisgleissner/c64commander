/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
  PlaylistItemRecord,
  PlaylistQueryOptions,
  PlaylistQueryResult,
  PlaylistSessionRecord,
  RandomPlaySession,
  TrackRecord,
} from "./types";
import type { PlaylistDataRepository } from "./repository";

type Options = {
  preferDurableStorage: boolean;
};

type PersistedState = {
  version: 2;
  tracks: Record<string, TrackRecord>;
  playlistItemsByPlaylistId: Record<string, PlaylistItemRecord[]>;
  sessionsByPlaylistId: Record<string, PlaylistSessionRecord>;
  randomSessionsByPlaylistId: Record<string, RandomPlaySession>;
};

type PlaylistOrderRecord = {
  "playlist-position": string[];
  title: string[];
  path: string[];
};

type StoredSchemaRecord = {
  version: 3;
};

const DB_NAME = "c64u-playlist-repository";
const DB_VERSION = 1;
const STORE = "state";
const LEGACY_STATE_KEY = "playlist-repository-state";
const META_SCHEMA_KEY = "meta:schema";
const INDEXEDDB_RECOVERY_STORAGE_KEY = "c64u_playlist_repo:indexeddb:recovery";
const CURRENT_SCHEMA_VERSION = 3;

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededShuffle = <T>(items: T[], seed: number) => {
  const next = [...items];
  let state = seed >>> 0;
  const random = () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const normalizeQuery = (value?: string) => value?.trim().toLowerCase() ?? "";

const buildRowSearchText = (track: TrackRecord) => {
  const parts = [
    track.title,
    track.author ?? "",
    track.released ?? "",
    track.path,
    track.sourceLocator,
    track.category ?? "",
  ];
  return parts.join(" ").toLowerCase();
};

const sortRows = (
  rows: Array<{ playlistItem: PlaylistItemRecord; track: TrackRecord }>,
  sort: PlaylistQueryOptions["sort"],
) => {
  const next = [...rows];
  next.sort((left, right) => {
    if (sort === "title") {
      const titleDiff = left.track.title.localeCompare(right.track.title);
      if (titleDiff !== 0) return titleDiff;
    }
    if (sort === "path") {
      const pathDiff = left.track.path.localeCompare(right.track.path);
      if (pathDiff !== 0) return pathDiff;
    }
    return left.playlistItem.sortKey.localeCompare(right.playlistItem.sortKey);
  });
  return next;
};

const buildPlaylistOrders = (
  playlistItems: PlaylistItemRecord[],
  tracksById: Map<string, TrackRecord>,
): PlaylistOrderRecord => {
  const rows = playlistItems
    .map((playlistItem) => {
      const track = tracksById.get(playlistItem.trackId);
      if (!track) return null;
      return { playlistItem, track };
    })
    .filter((row): row is { playlistItem: PlaylistItemRecord; track: TrackRecord } => Boolean(row));

  return {
    "playlist-position": sortRows(rows, "playlist-position").map((row) => row.playlistItem.playlistItemId),
    title: sortRows(rows, "title").map((row) => row.playlistItem.playlistItemId),
    path: sortRows(rows, "path").map((row) => row.playlistItem.playlistItemId),
  };
};

const writeRecoveryArtifact = (reason: string, raw: unknown, extra: Record<string, unknown> = {}) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    INDEXEDDB_RECOVERY_STORAGE_KEY,
    JSON.stringify({
      reason,
      raw,
      createdAt: new Date().toISOString(),
      ...extra,
    }),
  );
};

const migrateState = (state: Record<string, unknown>): PersistedState => ({
  version: 2,
  tracks: (state.tracks as Record<string, TrackRecord> | null | undefined) ?? {},
  playlistItemsByPlaylistId:
    (state.playlistItemsByPlaylistId as Record<string, PlaylistItemRecord[]> | null | undefined) ?? {},
  sessionsByPlaylistId: (state.sessionsByPlaylistId as Record<string, PlaylistSessionRecord> | null | undefined) ?? {},
  randomSessionsByPlaylistId:
    (state.randomSessionsByPlaylistId as Record<string, RandomPlaySession> | null | undefined) ?? {},
});

const trackKey = (trackId: string) => `track:${trackId}`;
const playlistItemKey = (playlistId: string, playlistItemId: string) => `playlist-item:${playlistId}:${playlistItemId}`;
const playlistOrderKey = (playlistId: string) => `playlist-order:${playlistId}`;
const sessionKey = (playlistId: string) => `session:${playlistId}`;
const randomSessionKey = (playlistId: string) => `random-session:${playlistId}`;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });

const readValues = async (keys: string[]): Promise<Map<string, unknown>> => {
  if (!keys.length) return new Map();
  const db = await openDb();
  try {
    return await new Promise<Map<string, unknown>>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const values = new Map<string, unknown>();
      let remaining = keys.length;
      let settled = false;

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      keys.forEach((key) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (settled) return;
          if (request.result !== undefined) {
            values.set(key, request.result);
          }
          remaining -= 1;
          if (remaining === 0) {
            settled = true;
            resolve(values);
          }
        };
        request.onerror = () => rejectOnce(request.error ?? new Error("IndexedDB read failed"));
      });
    });
  } finally {
    db.close();
  }
};

const readValue = async <T>(key: string): Promise<T | null> => {
  const values = await readValues([key]);
  return (values.get(key) as T | undefined) ?? null;
};

const isOpenFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /open/i.test(message);
};

const warnReadFailureAndReturn = <T>(error: unknown, fallback: T) => {
  console.warn("Failed to load playlist repository state from IndexedDB", {
    error,
  });
  return fallback;
};

const writeValues = async (entries: Array<[string, unknown]>) => {
  if (!entries.length) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      let remaining = entries.length;
      let settled = false;

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      entries.forEach(([key, value]) => {
        const request = store.put(value, key);
        request.onsuccess = () => {
          if (settled) return;
          remaining -= 1;
          if (remaining === 0) {
            settled = true;
            resolve();
          }
        };
        request.onerror = () => rejectOnce(request.error ?? new Error("IndexedDB write failed"));
      });
    });
  } finally {
    db.close();
  }
};

const persistMigratedState = async (state: PersistedState) => {
  const entries: Array<[string, unknown]> = [
    [META_SCHEMA_KEY, { version: CURRENT_SCHEMA_VERSION } satisfies StoredSchemaRecord],
  ];

  Object.values(state.tracks).forEach((track) => {
    entries.push([trackKey(track.trackId), track]);
  });

  Object.entries(state.playlistItemsByPlaylistId).forEach(([playlistId, playlistItems]) => {
    const sortedItems = [...playlistItems].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    const tracksById = new Map(
      sortedItems
        .map((item) => state.tracks[item.trackId])
        .filter((track): track is TrackRecord => Boolean(track))
        .map((track) => [track.trackId, track]),
    );
    sortedItems.forEach((playlistItem) => {
      entries.push([playlistItemKey(playlistId, playlistItem.playlistItemId), playlistItem]);
    });
    entries.push([playlistOrderKey(playlistId), buildPlaylistOrders(sortedItems, tracksById)]);
  });

  Object.values(state.sessionsByPlaylistId).forEach((session) => {
    entries.push([sessionKey(session.playlistId), session]);
  });

  Object.values(state.randomSessionsByPlaylistId).forEach((session) => {
    entries.push([randomSessionKey(session.playlistId), session]);
  });

  await writeValues(entries);
};

class IndexedDbPlaylistDataRepository implements PlaylistDataRepository {
  private initializationPromise: Promise<void> | null = null;

  constructor(private readonly options: Options) {
    if (this.options.preferDurableStorage && typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist();
    }
  }

  private async ensureInitialized() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      const schema = await readValue<StoredSchemaRecord>(META_SCHEMA_KEY).catch((error) => {
        console.warn("Failed to load playlist repository state from IndexedDB", {
          error,
        });
        return null;
      });
      if (schema?.version === CURRENT_SCHEMA_VERSION) {
        return;
      }

      const legacy = await readValue<unknown>(LEGACY_STATE_KEY).catch((error) => {
        console.warn("Failed to load playlist repository state from IndexedDB", {
          error,
        });
        return null;
      });

      if (!legacy) {
        await writeValues([[META_SCHEMA_KEY, { version: CURRENT_SCHEMA_VERSION } satisfies StoredSchemaRecord]]);
        return;
      }

      if (typeof legacy !== "object") {
        console.warn("Incompatible playlist repository schema in IndexedDB. Resetting repository state.", {
          expectedVersion: CURRENT_SCHEMA_VERSION,
          foundVersion: null,
        });
        writeRecoveryArtifact("incompatible-schema", legacy, { foundVersion: null });
        await writeValues([[META_SCHEMA_KEY, { version: CURRENT_SCHEMA_VERSION } satisfies StoredSchemaRecord]]);
        return;
      }

      const version = (legacy as { version?: unknown }).version;
      if (version !== 1 && version !== 2) {
        console.warn("Incompatible playlist repository schema in IndexedDB. Resetting repository state.", {
          expectedVersion: CURRENT_SCHEMA_VERSION,
          foundVersion: version,
        });
        writeRecoveryArtifact("incompatible-schema", legacy, { foundVersion: version });
        await writeValues([[META_SCHEMA_KEY, { version: CURRENT_SCHEMA_VERSION } satisfies StoredSchemaRecord]]);
        return;
      }

      await persistMigratedState(migrateState(legacy as Record<string, unknown>));
    })();

    return this.initializationPromise;
  }

  async upsertTracks(tracks: TrackRecord[]): Promise<void> {
    await this.ensureInitialized();
    await writeValues(tracks.map((track) => [trackKey(track.trackId), track]));
  }

  async getTracksByIds(trackIds: string[]): Promise<Map<string, TrackRecord>> {
    await this.ensureInitialized();
    const values = await readValues(trackIds.map((trackId) => trackKey(trackId))).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn(error, new Map<string, unknown>());
    });
    const tracks = new Map<string, TrackRecord>();
    trackIds.forEach((trackId) => {
      const track = values.get(trackKey(trackId)) as TrackRecord | undefined;
      if (track) {
        tracks.set(trackId, track);
      }
    });
    return tracks;
  }

  async replacePlaylistItems(playlistId: string, items: PlaylistItemRecord[]): Promise<void> {
    await this.ensureInitialized();
    const sortedItems = [...items].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    const tracksById = await this.getTracksByIds([...new Set(sortedItems.map((item) => item.trackId))]);
    const orders = buildPlaylistOrders(sortedItems, tracksById);
    await writeValues([
      ...sortedItems.map((item) => [playlistItemKey(playlistId, item.playlistItemId), item] as [string, unknown]),
      [playlistOrderKey(playlistId), orders],
    ]);
  }

  async getPlaylistItems(playlistId: string): Promise<PlaylistItemRecord[]> {
    await this.ensureInitialized();
    const orders = await readValue<PlaylistOrderRecord>(playlistOrderKey(playlistId)).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn<PlaylistOrderRecord | null>(error, null);
    });
    const orderedIds = orders?.["playlist-position"] ?? [];
    const values = await readValues(
      orderedIds.map((playlistItemId) => playlistItemKey(playlistId, playlistItemId)),
    ).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn(error, new Map<string, unknown>());
    });
    return orderedIds
      .map(
        (playlistItemId) => values.get(playlistItemKey(playlistId, playlistItemId)) as PlaylistItemRecord | undefined,
      )
      .filter((item): item is PlaylistItemRecord => Boolean(item));
  }

  async saveSession(session: PlaylistSessionRecord): Promise<void> {
    await this.ensureInitialized();
    await writeValues([[sessionKey(session.playlistId), session]]);
  }

  async getSession(playlistId: string): Promise<PlaylistSessionRecord | null> {
    await this.ensureInitialized();
    return readValue<PlaylistSessionRecord>(sessionKey(playlistId)).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn<PlaylistSessionRecord | null>(error, null);
    });
  }

  async queryPlaylist(options: PlaylistQueryOptions): Promise<PlaylistQueryResult> {
    await this.ensureInitialized();
    const orders = await readValue<PlaylistOrderRecord>(playlistOrderKey(options.playlistId)).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn<PlaylistOrderRecord | null>(error, null);
    });
    const sort = options.sort ?? "playlist-position";
    const orderedIds = orders?.[sort] ?? orders?.["playlist-position"] ?? [];
    if (!orderedIds.length) {
      return {
        rows: [],
        totalMatchCount: 0,
      };
    }

    const normalizedQuery = normalizeQuery(options.query);
    const categoryFilter = options.categoryFilter?.length ? new Set(options.categoryFilter) : null;
    const offset = Math.max(0, options.offset);
    const limit = Math.max(1, options.limit);
    const rows: PlaylistQueryResult["rows"] = [];
    let totalMatchCount = 0;
    const chunkSize = 200;

    for (let chunkStart = 0; chunkStart < orderedIds.length; chunkStart += chunkSize) {
      const chunkIds = orderedIds.slice(chunkStart, chunkStart + chunkSize);
      const itemValues = await readValues(
        chunkIds.map((playlistItemId) => playlistItemKey(options.playlistId, playlistItemId)),
      ).catch((error) => {
        if (isOpenFailure(error)) {
          throw error;
        }
        return warnReadFailureAndReturn(error, new Map<string, unknown>());
      });
      const playlistItems = chunkIds
        .map(
          (playlistItemId) =>
            itemValues.get(playlistItemKey(options.playlistId, playlistItemId)) as PlaylistItemRecord | undefined,
        )
        .filter((item): item is PlaylistItemRecord => Boolean(item));
      const tracks = await this.getTracksByIds([...new Set(playlistItems.map((item) => item.trackId))]);

      playlistItems.forEach((playlistItem) => {
        const track = tracks.get(playlistItem.trackId);
        if (!track) return;
        if (categoryFilter && !categoryFilter.has(track.category ?? "")) return;
        if (normalizedQuery && !buildRowSearchText(track).includes(normalizedQuery)) return;
        totalMatchCount += 1;
        if (totalMatchCount <= offset || rows.length >= limit) {
          return;
        }
        rows.push({
          playlistItem,
          track,
        });
      });
    }

    return {
      rows,
      totalMatchCount,
    };
  }

  async createSession(playlistId: string, orderedPlaylistItemIds: string[], seed?: number): Promise<RandomPlaySession> {
    await this.ensureInitialized();
    const resolvedSeed =
      typeof seed === "number" ? seed : stableHash(`${playlistId}:${orderedPlaylistItemIds.join("|")}:${Date.now()}`);
    const session: RandomPlaySession = {
      playlistId,
      seed: resolvedSeed,
      cursor: 0,
      order: seededShuffle(orderedPlaylistItemIds, resolvedSeed),
    };
    await this.saveRandomSession(session);
    return session;
  }

  async next(playlistId: string): Promise<string | null> {
    await this.ensureInitialized();
    const session = await this.getRandomSession(playlistId);
    if (!session || !session.order.length) return null;
    const current = session.order[session.cursor] ?? null;
    if (current === null) return null;
    const nextCursor = session.cursor + 1;
    const nextSession: RandomPlaySession = {
      ...session,
      cursor: nextCursor >= session.order.length ? 0 : nextCursor,
    };
    await this.saveRandomSession(nextSession);
    return current;
  }

  async getRandomSession(playlistId: string): Promise<RandomPlaySession | null> {
    await this.ensureInitialized();
    return readValue<RandomPlaySession>(randomSessionKey(playlistId)).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn<RandomPlaySession | null>(error, null);
    });
  }

  async saveRandomSession(session: RandomPlaySession): Promise<void> {
    await this.ensureInitialized();
    await writeValues([[randomSessionKey(session.playlistId), session]]);
  }
}

let indexedDbRepository: PlaylistDataRepository | null = null;

export const getIndexedDbPlaylistDataRepository = (options: Options): PlaylistDataRepository => {
  if (!indexedDbRepository) {
    indexedDbRepository = new IndexedDbPlaylistDataRepository(options);
  }
  return indexedDbRepository;
};

export const resetIndexedDbPlaylistRepositoryForTests = () => {
  indexedDbRepository = null;
};
