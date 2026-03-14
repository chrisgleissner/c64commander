import type {
  PlaylistItemRecord,
  PlaylistQueryOptions,
  PlaylistQueryResult,
  PlaylistSessionRecord,
  RandomPlaySession,
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
  queryIndexesByPlaylistId: Record<string, PersistedPlaylistQueryIndex>;
};

const DB_NAME = "c64u-playlist-repository";
const DB_VERSION = 1;
const STORE = "state";
const STATE_KEY = "playlist-repository-state";
const INDEXEDDB_RECOVERY_STORAGE_KEY = "c64u_playlist_repo:indexeddb:recovery";

const defaultState = (): PersistedState => ({
  version: 2,
  tracks: {},
  playlistItemsByPlaylistId: {},
  sessionsByPlaylistId: {},
  randomSessionsByPlaylistId: {},
  queryIndexesByPlaylistId: {},
});

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

const rebuildPlaylistIndex = (state: PersistedState, playlistId: string) => {
  state.queryIndexesByPlaylistId[playlistId] = buildPlaylistQueryIndex(
    state.playlistItemsByPlaylistId[playlistId] ?? [],
    state.tracks,
  );
};

const rebuildPlaylistIndexesForTracks = (state: PersistedState, trackIds: string[]) => {
  const affectedTrackIds = new Set(trackIds);
  Object.entries(state.playlistItemsByPlaylistId).forEach(([playlistId, items]) => {
    if (items.some((item) => affectedTrackIds.has(item.trackId))) {
      rebuildPlaylistIndex(state, playlistId);
    }
  });
};

const migrateState = (state: Record<string, unknown>) => {
  const next: PersistedState = {
    version: 2,
    tracks: (state.tracks as Record<string, TrackRecord> | null | undefined) ?? {},
    playlistItemsByPlaylistId:
      (state.playlistItemsByPlaylistId as Record<string, PlaylistItemRecord[]> | null | undefined) ?? {},
    sessionsByPlaylistId:
      (state.sessionsByPlaylistId as Record<string, PlaylistSessionRecord> | null | undefined) ?? {},
    randomSessionsByPlaylistId:
      (state.randomSessionsByPlaylistId as Record<string, RandomPlaySession> | null | undefined) ?? {},
    queryIndexesByPlaylistId: {},
  };

  Object.keys(next.playlistItemsByPlaylistId).forEach((playlistId) => {
    rebuildPlaylistIndex(next, playlistId);
  });

  return next;
};

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

const loadState = async (): Promise<PersistedState> => {
  const db = await openDb();
  try {
    const state = await new Promise<PersistedState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const request = store.get(STATE_KEY);
      request.onsuccess = () => resolve((request.result as PersistedState | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
    if (!state) {
      return defaultState();
    }
    if (typeof state !== "object") {
      console.warn("Incompatible playlist repository schema in IndexedDB. Resetting repository state.", {
        expectedVersion: 2,
        foundVersion: null,
      });
      writeRecoveryArtifact("incompatible-schema", state, { foundVersion: null });
      return defaultState();
    }
    const version = (state as { version?: unknown }).version;
    if (version !== 1 && version !== 2) {
      console.warn("Incompatible playlist repository schema in IndexedDB. Resetting repository state.", {
        expectedVersion: 2,
        foundVersion: version,
      });
      writeRecoveryArtifact("incompatible-schema", state, { foundVersion: version });
      return defaultState();
    }
    return migrateState(state as Record<string, unknown>);
  } catch (error) {
    console.warn("Failed to load playlist repository state from IndexedDB", {
      error,
    });
    return defaultState();
  } finally {
    db.close();
  }
};

const writeState = async (state: PersistedState) => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.put(state, STATE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed"));
    });
  } finally {
    db.close();
  }
};

class IndexedDbPlaylistDataRepository implements PlaylistDataRepository {
  private statePromise: Promise<PersistedState>;

  constructor(private readonly options: Options) {
    this.statePromise = loadState();
    if (this.options.preferDurableStorage && typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist();
    }
  }

  private async withState<T>(operation: (state: PersistedState) => Promise<T> | T): Promise<T> {
    const state = await this.statePromise;
    const result = await operation(state);
    await writeState(state);
    return result;
  }

  async upsertTracks(tracks: TrackRecord[]): Promise<void> {
    await this.withState(async (state) => {
      tracks.forEach((track) => {
        state.tracks[track.trackId] = track;
      });
      rebuildPlaylistIndexesForTracks(
        state,
        tracks.map((track) => track.trackId),
      );
    });
  }

  async getTracksByIds(trackIds: string[]): Promise<Map<string, TrackRecord>> {
    const state = await this.statePromise;
    const map = new Map<string, TrackRecord>();
    trackIds.forEach((trackId) => {
      const track = state.tracks[trackId];
      if (track) map.set(trackId, track);
    });
    return map;
  }

  async replacePlaylistItems(playlistId: string, items: PlaylistItemRecord[]): Promise<void> {
    await this.withState(async (state) => {
      state.playlistItemsByPlaylistId[playlistId] = [...items].sort((left, right) =>
        left.sortKey.localeCompare(right.sortKey),
      );
      rebuildPlaylistIndex(state, playlistId);
    });
  }

  async getPlaylistItems(playlistId: string): Promise<PlaylistItemRecord[]> {
    const state = await this.statePromise;
    return [...(state.playlistItemsByPlaylistId[playlistId] ?? [])].sort((left, right) =>
      left.sortKey.localeCompare(right.sortKey),
    );
  }

  async saveSession(session: PlaylistSessionRecord): Promise<void> {
    await this.withState(async (state) => {
      state.sessionsByPlaylistId[session.playlistId] = session;
    });
  }

  async getSession(playlistId: string): Promise<PlaylistSessionRecord | null> {
    const state = await this.statePromise;
    return state.sessionsByPlaylistId[playlistId] ?? null;
  }

  async queryPlaylist(options: PlaylistQueryOptions): Promise<PlaylistQueryResult> {
    const state = await this.statePromise;
    const index = state.queryIndexesByPlaylistId[options.playlistId] ?? buildPlaylistQueryIndex([], {});
    return queryPlaylistIndex(index, options);
  }

  async createSession(playlistId: string, orderedPlaylistItemIds: string[], seed?: number): Promise<RandomPlaySession> {
    return this.withState(async (state) => {
      const resolvedSeed =
        typeof seed === "number" ? seed : stableHash(`${playlistId}:${orderedPlaylistItemIds.join("|")}:${Date.now()}`);
      const order = seededShuffle(orderedPlaylistItemIds, resolvedSeed);
      const session: RandomPlaySession = {
        playlistId,
        seed: resolvedSeed,
        cursor: 0,
        order,
      };
      state.randomSessionsByPlaylistId[playlistId] = session;
      return session;
    });
  }

  async next(playlistId: string): Promise<string | null> {
    return this.withState(async (state) => {
      const session = state.randomSessionsByPlaylistId[playlistId];
      if (!session || !session.order.length) return null;
      const current = session.order[session.cursor] ?? null;
      if (current === null) return null;
      const nextCursor = session.cursor + 1;
      session.cursor = nextCursor >= session.order.length ? 0 : nextCursor;
      state.randomSessionsByPlaylistId[playlistId] = session;
      return current;
    });
  }

  async getRandomSession(playlistId: string): Promise<RandomPlaySession | null> {
    const state = await this.statePromise;
    return state.randomSessionsByPlaylistId[playlistId] ?? null;
  }

  async saveRandomSession(session: RandomPlaySession): Promise<void> {
    await this.withState(async (state) => {
      state.randomSessionsByPlaylistId[session.playlistId] = session;
    });
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
