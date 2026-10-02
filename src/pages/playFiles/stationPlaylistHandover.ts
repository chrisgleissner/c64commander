/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
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
};

export type StationHandoverRecord = Omit<StationHandover, "items">;

export type PlaylistPosition = {
  playlist: readonly PlaylistItem[];
  currentIndex: number;
  selectedIds: ReadonlySet<string>;
};

/** Only the first station saves the playlist; a second one started over it keeps that copy. */
export const handoverForStationStart = (
  existing: StationHandover | null,
  current: PlaylistPosition,
  stationItems: readonly PlaylistItem[],
): StationHandover => {
  const stationItemIds = stationItems.map((item) => item.id);
  if (existing) return { ...existing, stationItemIds, phase: "station" };
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
  (input.playlistEnded || (!input.isPlaying && !input.isPaused));

export const restoredPlaylistState = (handover: StationHandover & { items: PlaylistItem[] }) => {
  const byId = handover.currentItemId ? handover.items.findIndex((item) => item.id === handover.currentItemId) : -1;
  const currentIndex = byId >= 0 ? byId : handover.currentIndex < handover.items.length ? handover.currentIndex : -1;
  return { playlist: handover.items, currentIndex, selectedIds: new Set(handover.selectedIds) };
};

const RECORD_KEY = "c64u_sid_radio_saved_playlist";

/** The playlist repository id the saved items are written under, beside the live playlist's own id. */
export const savedPlaylistRepositoryId = (playlistStorageKey: string) => `${playlistStorageKey}:before-sid-radio`;

export const writeHandoverRecord = (handover: StationHandover): void => {
  const { items: _items, ...record } = handover;
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
