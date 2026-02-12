import type {
  PlaylistItemRecord,
  PlaylistQueryOptions,
  PlaylistQueryResult,
  PlaylistQueryRow,
  PlaylistSessionRecord,
  RandomPlaySession,
  TrackRecord,
} from './types';
import type { PlaylistDataRepository } from './repository';

type Options = {
  preferDurableStorage: boolean;
};

type PersistedState = {
  version: 1;
  tracks: Record<string, TrackRecord>;
  playlistItemsByPlaylistId: Record<string, PlaylistItemRecord[]>;
  sessionsByPlaylistId: Record<string, PlaylistSessionRecord>;
  randomSessionsByPlaylistId: Record<string, RandomPlaySession>;
};

const DB_NAME = 'c64u-playlist-repository';
const DB_VERSION = 1;
const STORE = 'state';
const STATE_KEY = 'playlist-repository-state';

const defaultState = (): PersistedState => ({
  version: 1,
  tracks: {},
  playlistItemsByPlaylistId: {},
  sessionsByPlaylistId: {},
  randomSessionsByPlaylistId: {},
});

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededShuffle = <T,>(items: T[], seed: number) => {
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

const normalizeQuery = (value?: string) => value?.trim().toLowerCase() ?? '';

const rowSearchText = (row: PlaylistQueryRow) => {
  const parts = [
    row.track.title,
    row.track.author ?? '',
    row.track.released ?? '',
    row.track.path,
    row.track.sourceLocator,
    row.track.category ?? '',
  ];
  return parts.join(' ').toLowerCase();
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
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });

const loadState = async (): Promise<PersistedState> => {
  const db = await openDb();
  try {
    const state = await new Promise<PersistedState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const request = store.get(STATE_KEY);
      request.onsuccess = () => resolve((request.result as PersistedState | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
    if (!state || state.version !== 1) {
      return defaultState();
    }
    return {
      version: 1,
      tracks: state.tracks ?? {},
      playlistItemsByPlaylistId: state.playlistItemsByPlaylistId ?? {},
      sessionsByPlaylistId: state.sessionsByPlaylistId ?? {},
      randomSessionsByPlaylistId: state.randomSessionsByPlaylistId ?? {},
    };
  } catch (error) {
    console.warn('Failed to load playlist repository state from IndexedDB', { error });
    return defaultState();
  } finally {
    db.close();
  }
};

const writeState = async (state: PersistedState) => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.put(state, STATE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
};

class IndexedDbPlaylistDataRepository implements PlaylistDataRepository {
  private statePromise: Promise<PersistedState>;

  constructor(private readonly options: Options) {
    this.statePromise = loadState();
    if (this.options.preferDurableStorage && typeof navigator !== 'undefined' && navigator.storage?.persist) {
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
    const playlistItems = [...(state.playlistItemsByPlaylistId[options.playlistId] ?? [])].sort((left, right) =>
      left.sortKey.localeCompare(right.sortKey),
    );

    const rows: PlaylistQueryRow[] = playlistItems
      .map((playlistItem) => {
        const track = state.tracks[playlistItem.trackId];
        if (!track) return null;
        return { playlistItem, track };
      })
      .filter((row): row is PlaylistQueryRow => Boolean(row));

    const query = normalizeQuery(options.query);
    const categoryFilter = options.categoryFilter?.length
      ? new Set(options.categoryFilter)
      : null;

    const withFilter = rows.filter((row) => {
      if (categoryFilter) {
        const category = row.track.category ?? null;
        if (!category || !categoryFilter.has(category)) return false;
      }
      if (!query) return true;
      return rowSearchText(row).includes(query);
    });

    const withSort = [...withFilter].sort((left, right) => {
      const sort = options.sort ?? 'playlist-position';
      if (sort === 'title') {
        const titleDiff = left.track.title.localeCompare(right.track.title);
        if (titleDiff !== 0) return titleDiff;
      }
      if (sort === 'path') {
        const pathDiff = left.track.path.localeCompare(right.track.path);
        if (pathDiff !== 0) return pathDiff;
      }
      return left.playlistItem.sortKey.localeCompare(right.playlistItem.sortKey);
    });

    const offset = Math.max(0, options.offset);
    const limit = Math.max(1, options.limit);
    return {
      rows: withSort.slice(offset, offset + limit),
      totalMatchCount: withSort.length,
    };
  }

  async createSession(playlistId: string, orderedPlaylistItemIds: string[], seed?: number): Promise<RandomPlaySession> {
    return this.withState(async (state) => {
      const resolvedSeed = typeof seed === 'number'
        ? seed
        : stableHash(`${playlistId}:${orderedPlaylistItemIds.join('|')}:${Date.now()}`);
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
