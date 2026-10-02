/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * The listener's playlist, set aside while a SID Radio station owns the queue.
 *
 * `phase` is "station" while the station runs and "finishing" once it has stopped and the tune it
 * was playing is allowed to end before the playlist comes back. `items` is null after a restart
 * until the saved copy has been read back from the playlist repository.
 */
export type StationHandover = {
  items: PlaylistItem[] | null;
  currentItemId: string | null;
  currentIndex: number;
  selectedIds: string[];
  stationItemIds: string[];
  phase: "station" | "finishing";
  /**
   * The station's last tune was left playing in this launch, so a pause is the listener's and the
   * playlist waits for the tune to end or be stopped. Not persisted: after a relaunch the tune comes
   * back paused without anyone having paused it, and the playlist comes back at once.
   */
  playsOutLastTune?: boolean;
};

export type StationHandoverRecord = Omit<StationHandover, "items" | "playsOutLastTune">;

export type PlaylistPosition = {
  playlist: readonly PlaylistItem[];
  currentIndex: number;
  selectedIds: ReadonlySet<string>;
};

/**
 * Only the first station saves the playlist; a second one started over it keeps that copy. Tunes the
 * listener queued while a stopped station's last tune played join the saved copy, since the new
 * station replaces the queue they are in.
 */
export const handoverForStationStart = (
  existing: StationHandover | null,
  current: PlaylistPosition,
  stationItems: readonly PlaylistItem[],
): StationHandover => {
  const stationItemIds = stationItems.map((item) => item.id);
  if (existing) {
    const items =
      existing.phase === "finishing" && existing.items
        ? restoredPlaylistState({ ...existing, items: existing.items }, current.playlist).playlist
        : existing.items;
    return { ...existing, items, stationItemIds, phase: "station", playsOutLastTune: undefined };
  }
  return {
    items: [...current.playlist],
    currentItemId: current.playlist[current.currentIndex]?.id ?? null,
    currentIndex: current.currentIndex,
    selectedIds: [...current.selectedIds],
    stationItemIds,
    phase: "station",
  };
};

export const withAppendedStationItems = (
  handover: StationHandover,
  appended: readonly PlaylistItem[],
): StationHandover => ({
  ...handover,
  stationItemIds: [...handover.stationItemIds, ...appended.map((item) => item.id)],
});

/** True when the listener added to or removed from the queue the station built. */
export const isStationQueueEdited = (playlist: readonly PlaylistItem[], stationItemIds: readonly string[]): boolean => {
  const stationIds = new Set(stationItemIds);
  if (playlist.some((item) => !stationIds.has(item.id))) return true;
  const queuedIds = new Set(playlist.map((item) => item.id));
  return stationItemIds.some((id) => !queuedIds.has(id));
};

/**
 * The queue while the stopped station's last tune plays out: that tune alone.
 *
 * With nothing after it, the end of the tune is the end of the queue, so playback stops there
 * instead of running on into whatever the station had queued next.
 */
export const lastTuneQueue = (playlist: readonly PlaylistItem[], currentIndex: number): PlaylistItem[] => {
  const current = playlist[currentIndex];
  return current ? [current] : [];
};

export const shouldRestorePlaylist = (input: {
  handover: StationHandover | null;
  ready: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  playlistEnded: boolean;
}): boolean =>
  input.ready &&
  input.handover?.phase === "finishing" &&
  input.handover.items !== null &&
  (input.playlistEnded || !input.isPlaying || (input.isPaused && !input.handover.playsOutLastTune));

/** Anything the listener queued during the last tune is kept, after the playlist that comes back. */
export const restoredPlaylistState = (
  handover: StationHandover & { items: PlaylistItem[] },
  queue: readonly PlaylistItem[] = [],
) => {
  const byId = handover.currentItemId ? handover.items.findIndex((item) => item.id === handover.currentItemId) : -1;
  const currentIndex = byId >= 0 ? byId : handover.currentIndex < handover.items.length ? handover.currentIndex : -1;
  const known = new Set([...handover.stationItemIds, ...handover.items.map((item) => item.id)]);
  const addedMeanwhile = queue.filter((item) => !known.has(item.id));
  return { playlist: [...handover.items, ...addedMeanwhile], currentIndex, selectedIds: new Set(handover.selectedIds) };
};

export const SAVED_PLAYLIST_READ = { attempts: 3, timeoutMs: 10_000, retryDelayMs: 1_000 };

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer within ${timeoutMs} ms`)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/** Reads the saved items back, retrying a bounded number of times; rejects with the last failure. */
export const readSavedPlaylistWithRetry = async (read: () => Promise<PlaylistItem[]>): Promise<PlaylistItem[]> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withTimeout(read(), SAVED_PLAYLIST_READ.timeoutMs);
    } catch (error) {
      if (attempt >= SAVED_PLAYLIST_READ.attempts) throw error;
      addLog("warn", "SID Radio: could not read back the playlist saved before the station, retrying", {
        attempt,
        error: (error as Error)?.message ?? String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, SAVED_PLAYLIST_READ.retryDelayMs * attempt));
    }
  }
};

const RECORD_KEY = "c64u_sid_radio_saved_playlist";

/** The playlist repository id the saved items are written under, beside the live playlist's own id. */
export const savedPlaylistRepositoryId = (playlistStorageKey: string) => `${playlistStorageKey}:before-sid-radio`;

export const writeHandoverRecord = (handover: StationHandover): void => {
  const { items: _items, playsOutLastTune: _playsOutLastTune, ...record } = handover;
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(record));
  } catch (error) {
    addErrorLog("Failed to persist the playlist saved before SID Radio", { error: (error as Error).message });
  }
};

export const readHandoverRecord = (): StationHandoverRecord | null => {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StationHandoverRecord;
    const valid =
      parsed &&
      (parsed.phase === "station" || parsed.phase === "finishing") &&
      Array.isArray(parsed.selectedIds) &&
      Array.isArray(parsed.stationItemIds);
    return valid ? parsed : null;
  } catch (error) {
    addErrorLog("Failed to read the playlist saved before SID Radio", { error: (error as Error).message });
    return null;
  }
};

export const clearHandoverRecord = (): void => {
  try {
    localStorage.removeItem(RECORD_KEY);
  } catch (error) {
    addErrorLog("Failed to clear the playlist saved before SID Radio", { error: (error as Error).message });
  }
};

// Survives the Play page unmounting on a tab switch, which a component's state does not.
let remembered: StationHandover | null = null;

export const rememberedHandover = (): StationHandover | null => {
  if (remembered) return remembered;
  const record = readHandoverRecord();
  return record ? { ...record, items: null } : null;
};

export const rememberHandover = (handover: StationHandover | null) => {
  remembered = handover;
};
