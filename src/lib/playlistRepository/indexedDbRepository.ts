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
  SerializedPlaylistSnapshot,
  TrackRecord,
} from "./types";
import type { PlaylistDataRepository } from "./repository";
import { buildPlaylistQueryIndex, queryPlaylistIndex, type PersistedPlaylistQueryIndex } from "./queryIndex";

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

type PlaylistOrderRecord = PersistedPlaylistQueryIndex["orderBy"];

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

const buildPlaylistOrders = (
  playlistItems: PlaylistItemRecord[],
  tracksById: Map<string, TrackRecord>,
): { orders: PlaylistOrderRecord; queryIndex: PersistedPlaylistQueryIndex } => {
  const queryIndex = buildPlaylistQueryIndex(playlistItems, Object.fromEntries(Array.from(tracksById.entries())));
  return {
    orders: queryIndex.orderBy,
    queryIndex,
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
const playlistQueryIndexKey = (playlistId: string) => `playlist-query-index:${playlistId}`;
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
    const { orders, queryIndex } = buildPlaylistOrders(sortedItems, tracksById);
    sortedItems.forEach((playlistItem) => {
      entries.push([playlistItemKey(playlistId, playlistItem.playlistItemId), playlistItem]);
    });
    entries.push([playlistOrderKey(playlistId), orders]);
    entries.push([playlistQueryIndexKey(playlistId), queryIndex]);
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

  async replacePlaylistSnapshot(playlistId: string, snapshot: SerializedPlaylistSnapshot): Promise<void> {
    await this.ensureInitialized();
    const sortedItems = [...snapshot.playlistItems].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    const tracksById = new Map(snapshot.tracks.map((track) => [track.trackId, track] as const));
    const { orders, queryIndex } = buildPlaylistOrders(sortedItems, tracksById);
    await writeValues([
      ...snapshot.tracks.map((track) => [trackKey(track.trackId), track] as [string, unknown]),
      ...sortedItems.map((item) => [playlistItemKey(playlistId, item.playlistItemId), item] as [string, unknown]),
      [playlistOrderKey(playlistId), orders],
      [playlistQueryIndexKey(playlistId), queryIndex],
    ]);
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
    const { orders, queryIndex } = buildPlaylistOrders(sortedItems, tracksById);
    await writeValues([
      ...sortedItems.map((item) => [playlistItemKey(playlistId, item.playlistItemId), item] as [string, unknown]),
      [playlistOrderKey(playlistId), orders],
      [playlistQueryIndexKey(playlistId), queryIndex],
    ]);
  }

  private async loadPlaylistQueryIndex(playlistId: string): Promise<PersistedPlaylistQueryIndex> {
    const persistedIndex = await readValue<PersistedPlaylistQueryIndex>(playlistQueryIndexKey(playlistId)).catch(
      (error) => {
        if (isOpenFailure(error)) {
          throw error;
        }
        return warnReadFailureAndReturn<PersistedPlaylistQueryIndex | null>(error, null);
      },
    );
    if (persistedIndex) {
      return persistedIndex;
    }

    const playlistItems = await this.getPlaylistItems(playlistId);
    if (!playlistItems.length) {
      return buildPlaylistQueryIndex([], {});
    }
    const tracksById = await this.getTracksByIds([...new Set(playlistItems.map((item) => item.trackId))]);
    const rebuiltIndex = buildPlaylistQueryIndex(playlistItems, Object.fromEntries(Array.from(tracksById.entries())));
    await writeValues([[playlistQueryIndexKey(playlistId), rebuiltIndex]]).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn(error, undefined);
    });
    return rebuiltIndex;
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

  async getPlaylistItemCount(playlistId: string): Promise<number> {
    await this.ensureInitialized();
    const orders = await readValue<PlaylistOrderRecord>(playlistOrderKey(playlistId)).catch((error) => {
      if (isOpenFailure(error)) {
        throw error;
      }
      return warnReadFailureAndReturn<PlaylistOrderRecord | null>(error, null);
    });
    return orders?.["playlist-position"]?.length ?? 0;
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
    const queryIndex = await this.loadPlaylistQueryIndex(options.playlistId);
    return queryPlaylistIndex(queryIndex, options);
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
