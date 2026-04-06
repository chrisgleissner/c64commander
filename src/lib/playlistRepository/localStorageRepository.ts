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
import { addLog } from "@/lib/logging";
import { buildPlaylistQueryIndex, queryPlaylistIndex, type PersistedPlaylistQueryIndex } from "./queryIndex";

type PersistedState = {
  version: 2;
  tracks: Record<string, TrackRecord>;
  playlistItemsByPlaylistId: Record<string, PlaylistItemRecord[]>;
  sessionsByPlaylistId: Record<string, PlaylistSessionRecord>;
  randomSessionsByPlaylistId: Record<string, RandomPlaySession>;
  queryIndexesByPlaylistId: Record<string, PersistedPlaylistQueryIndex>;
};

const STORAGE_KEY = "c64u_playlist_repo:v1";
const BACKUP_STORAGE_KEY = "c64u_playlist_repo:v1:backup";
const RECOVERY_STORAGE_KEY = "c64u_playlist_repo:v1:recovery";

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

const writeRecoveryArtifact = (reason: string, raw: string, extra: Record<string, unknown> = {}) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    RECOVERY_STORAGE_KEY,
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

const migrateState = (parsed: Record<string, unknown>) => {
  const next: PersistedState = {
    version: 2,
    tracks: (parsed.tracks as Record<string, TrackRecord> | null | undefined) ?? {},
    playlistItemsByPlaylistId:
      (parsed.playlistItemsByPlaylistId as Record<string, PlaylistItemRecord[]> | null | undefined) ?? {},
    sessionsByPlaylistId:
      (parsed.sessionsByPlaylistId as Record<string, PlaylistSessionRecord> | null | undefined) ?? {},
    randomSessionsByPlaylistId:
      (parsed.randomSessionsByPlaylistId as Record<string, RandomPlaySession> | null | undefined) ?? {},
    queryIndexesByPlaylistId: {},
  };

  Object.keys(next.playlistItemsByPlaylistId).forEach((playlistId) => {
    rebuildPlaylistIndex(next, playlistId);
  });

  return next;
};

const safeReadState = (): PersistedState => {
  if (typeof localStorage === "undefined") return defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as PersistedState | Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") {
      addLog(
        "warn",
        "Incompatible localStorage playlist repository schema. Preserving backup and resetting repository state.",
        {
          storageKey: STORAGE_KEY,
          backupStorageKey: BACKUP_STORAGE_KEY,
          version: null,
        },
      );
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(BACKUP_STORAGE_KEY, raw);
      }
      writeRecoveryArtifact("incompatible-schema", raw, { version: null });
      return defaultState();
    }
    const version = (parsed as { version?: unknown }).version;
    if (version !== 1 && version !== 2) {
      addLog(
        "warn",
        "Incompatible localStorage playlist repository schema. Preserving backup and resetting repository state.",
        {
          storageKey: STORAGE_KEY,
          backupStorageKey: BACKUP_STORAGE_KEY,
          version,
        },
      );
      localStorage.setItem(BACKUP_STORAGE_KEY, raw);
      writeRecoveryArtifact("incompatible-schema", raw, { version });
      return defaultState();
    }
    return migrateState(parsed as Record<string, unknown>);
  } catch (error) {
    addLog("warn", "Failed to parse localStorage playlist repository state. Resetting repository state.", {
      storageKey: STORAGE_KEY,
      error: (error as Error).message,
    });
    localStorage.setItem(BACKUP_STORAGE_KEY, raw);
    writeRecoveryArtifact("parse-failure", raw, { error: (error as Error).message });
    return defaultState();
  }
};

const safeWriteState = (state: PersistedState) => {
  if (typeof localStorage === "undefined") return;
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
    rebuildPlaylistIndexesForTracks(
      this.state,
      tracks.map((track) => track.trackId),
    );
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
    rebuildPlaylistIndex(this.state, playlistId);
    this.commit();
  }

  async getPlaylistItems(playlistId: string) {
    return [...(this.state.playlistItemsByPlaylistId[playlistId] ?? [])].sort((left, right) =>
      left.sortKey.localeCompare(right.sortKey),
    );
  }

  async getPlaylistItemCount(playlistId: string) {
    return this.state.playlistItemsByPlaylistId[playlistId]?.length ?? 0;
  }

  async saveSession(session: PlaylistSessionRecord) {
    this.state.sessionsByPlaylistId[session.playlistId] = session;
    this.commit();
  }

  async getSession(playlistId: string) {
    return this.state.sessionsByPlaylistId[playlistId] ?? null;
  }

  async queryPlaylist(options: PlaylistQueryOptions): Promise<PlaylistQueryResult> {
    const index = this.state.queryIndexesByPlaylistId[options.playlistId] ?? buildPlaylistQueryIndex([], {});
    return queryPlaylistIndex(index, options);
  }

  async createSession(playlistId: string, orderedPlaylistItemIds: string[], seed?: number) {
    const resolvedSeed =
      typeof seed === "number" ? seed : stableHash(`${playlistId}:${orderedPlaylistItemIds.join("|")}:${Date.now()}`);
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
