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

type PersistedState = {
  version: 1;
  tracks: Record<string, TrackRecord>;
  playlistItemsByPlaylistId: Record<string, PlaylistItemRecord[]>;
  sessionsByPlaylistId: Record<string, PlaylistSessionRecord>;
  randomSessionsByPlaylistId: Record<string, RandomPlaySession>;
};

const STORAGE_KEY = 'c64u_playlist_repo:v1';

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

const safeReadState = (): PersistedState => {
  if (typeof localStorage === 'undefined') return defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || parsed.version !== 1) return defaultState();
    return {
      version: 1,
      tracks: parsed.tracks ?? {},
      playlistItemsByPlaylistId: parsed.playlistItemsByPlaylistId ?? {},
      sessionsByPlaylistId: parsed.sessionsByPlaylistId ?? {},
      randomSessionsByPlaylistId: parsed.randomSessionsByPlaylistId ?? {},
    };
  } catch (error) {
    console.warn('Failed to parse localStorage playlist repository state. Resetting repository state.', { error });
    return defaultState();
  }
};

const safeWriteState = (state: PersistedState) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

class LocalStoragePlaylistDataRepository implements PlaylistDataRepository {
  private state = safeReadState();

  private commit() {
    safeWriteState(this.state);
  }

  async upsertTracks(tracks: TrackRecord[]) {
    tracks.forEach((track) => {
      this.state.tracks[track.trackId] = track;
    });
    this.commit();
  }

  async getTracksByIds(trackIds: string[]) {
    const map = new Map<string, TrackRecord>();
    trackIds.forEach((trackId) => {
      const track = this.state.tracks[trackId];
      if (track) map.set(trackId, track);
    });
    return map;
  }

  async replacePlaylistItems(playlistId: string, items: PlaylistItemRecord[]) {
    this.state.playlistItemsByPlaylistId[playlistId] = [...items].sort((left, right) =>
      left.sortKey.localeCompare(right.sortKey),
    );
    this.commit();
  }

  async getPlaylistItems(playlistId: string) {
    return [...(this.state.playlistItemsByPlaylistId[playlistId] ?? [])].sort((left, right) =>
      left.sortKey.localeCompare(right.sortKey),
    );
  }

  async saveSession(session: PlaylistSessionRecord) {
    this.state.sessionsByPlaylistId[session.playlistId] = session;
    this.commit();
  }

  async getSession(playlistId: string) {
    return this.state.sessionsByPlaylistId[playlistId] ?? null;
  }

  async queryPlaylist(options: PlaylistQueryOptions): Promise<PlaylistQueryResult> {
    const playlistItems = await this.getPlaylistItems(options.playlistId);
    const rows: PlaylistQueryRow[] = playlistItems
      .map((playlistItem) => {
        const track = this.state.tracks[playlistItem.trackId];
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

  async createSession(playlistId: string, orderedPlaylistItemIds: string[], seed?: number) {
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
    this.state.randomSessionsByPlaylistId[playlistId] = session;
    this.commit();
    return session;
  }

  async next(playlistId: string) {
    const session = this.state.randomSessionsByPlaylistId[playlistId];
    if (!session || !session.order.length) return null;
    const current = session.order[session.cursor] ?? null;
    if (current === null) return null;
    const nextCursor = session.cursor + 1;
    session.cursor = nextCursor >= session.order.length ? 0 : nextCursor;
    this.state.randomSessionsByPlaylistId[playlistId] = session;
    this.commit();
    return current;
  }

  async getRandomSession(playlistId: string) {
    return this.state.randomSessionsByPlaylistId[playlistId] ?? null;
  }

  async saveRandomSession(session: RandomPlaySession): Promise<void> {
    this.state.randomSessionsByPlaylistId[session.playlistId] = session;
    this.commit();
  }
}

export const getLocalStoragePlaylistDataRepository = () => {
  return new LocalStoragePlaylistDataRepository();
};
