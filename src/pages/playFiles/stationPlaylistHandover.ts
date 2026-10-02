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
  /**
   * The queue the listener had when a station started over a saved copy this launch could not read
   * back. Appended after that copy when the playlist returns; held in memory only.
   */
  carriedItems?: PlaylistItem[];
};

export type StationHandoverRecord = Omit<StationHandover, "items" | "playsOutLastTune" | "carriedItems">;

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
    const carriedItems =
      existing.items === null
        ? itemsNotIn(
            current.playlist.filter((item) => !isStationBuiltItem(item)),
            existing.stationItemIds,
            existing.carriedItems,
          )
        : undefined;
    return { ...existing, items, stationItemIds, phase: "station", playsOutLastTune: undefined, carriedItems };
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
  const carried = itemsNotIn(
    handover.carriedItems ?? [],
    handover.items.map((item) => item.id),
  );
  const known = new Set([
    ...handover.stationItemIds,
    ...handover.items.map((item) => item.id),
    ...carried.map((i) => i.id),
  ]);
  const addedMeanwhile = queue.filter((item) => !known.has(item.id));
  return {
    playlist: [...handover.items, ...carried, ...addedMeanwhile],
    currentIndex,
    selectedIds: new Set(handover.selectedIds),
  };
};

/** SID Radio builds its queue items with `radio:` ids (useSidRadio's buildStationItem); nothing else does. */
const isStationBuiltItem = (item: PlaylistItem) => item.id.startsWith("radio:");

const itemsNotIn = (
  items: readonly PlaylistItem[],
  excludedIds: readonly string[],
  alreadyKept: readonly PlaylistItem[] = [],
): PlaylistItem[] => {
  const excluded = new Set([...excludedIds, ...alreadyKept.map((item) => item.id)]);
  return [...alreadyKept, ...items.filter((item) => !excluded.has(item.id))];
};

export const SAVED_PLAYLIST_READ = { attempts: 3, timeoutMs: 10_000, retryDelayMs: 1_000 };

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer within ${timeoutMs} ms`)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/**
 * Reads the saved items back, retrying a bounded number of times; rejects with the last failure. The
 * caller's `read` joins a read still running, so retrying after a timeout waits on it again rather
 * than starting another.
 */
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
  const { items: _items, playsOutLastTune: _playsOutLastTune, carriedItems: _carriedItems, ...record } = handover;
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

/** The persisted handover with its items not yet read back, or null when no playlist is saved. */
export const unreadSavedHandover = (): StationHandover | null => {
  const record = readHandoverRecord();
  return record ? { ...record, items: null } : null;
};

// Survives the Play page unmounting on a tab switch, which a component's state does not. "unreadable":
// this launch gave up reading the saved copy back; it stays saved for the next launch to read.
let remembered: StationHandover | null | "unreadable" = null;
let inFlightSavedRead: Promise<PlaylistItem[]> | null = null;

/** One read of the saved copy at a time per app session; a later caller, on any mount, joins it. */
export const readSavedCopyOnce = (read: () => Promise<PlaylistItem[]>): Promise<PlaylistItem[]> => {
  if (!inFlightSavedRead) {
    const reading = read();
    inFlightSavedRead = reading;
    const release = () => {
      if (inFlightSavedRead === reading) inFlightSavedRead = null;
    };
    reading.then(release, release);
  }
  return inFlightSavedRead;
};

export const rememberedHandover = (): StationHandover | null => {
  if (remembered === "unreadable") return null;
  return remembered ?? unreadSavedHandover();
};

export const rememberHandover = (handover: StationHandover | null) => {
  remembered = handover;
};

/** Starts a fresh app session's view of the saved copy: nothing remembered, no read in flight. */
export const resetStationHandoverSession = () => {
  remembered = null;
  inFlightSavedRead = null;
};

export const rememberSavedCopyUnreadable = () => {
  remembered = "unreadable";
};
