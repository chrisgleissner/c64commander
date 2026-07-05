/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { mergeAudioMixerOptions } from "@/lib/config/audioMixer";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaylistItem } from "./types";

export type AudioMixerItem = {
  name: string;
  value: string | number;
  options?: string[];
};

export const CATEGORY_OPTIONS: PlayFileCategory[] = ["sid", "mod", "prg", "crt", "disk"];
export const SHARED_PLAYLIST_STORAGE_KEY = "c64u_playlist:v2:shared";
export const buildPlaylistStorageKey = (deviceId: string) => `c64u_playlist:v1:${deviceId}`;
export const LAST_DEVICE_ID_KEY = "c64u_last_device_id";
export const PLAYLIST_STORAGE_PREFIX = "c64u_playlist:v1:";
export const PLAYBACK_SESSION_KEY = "c64u_playback_session:v1";
export const DEFAULT_SONG_DURATION_MS = 3 * 60 * 1000;
export const DURATION_MIN_SECONDS = 1;
export const DURATION_MAX_SECONDS = 3600;
export const DURATION_SLIDER_STEPS = 1000;

export const formatTime = (ms?: number) => {
  if (ms === undefined) return "—:—";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const formatBytes = (value?: number | null) => {
  if (value === null || value === undefined || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
};

export const isSongCategory = (category: PlayFileCategory) => category === "sid" || category === "mod";

export const normalizeLocalPath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export const getLocalFilePath = (file: LocalPlayFile) => {
  const candidate =
    (file as File).webkitRelativePath || (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return normalizeLocalPath(candidate);
};

export const parseDurationInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(":")) {
    const [minutesRaw, secondsRaw] = trimmed.split(":");
    const minutes = Number(minutesRaw);
    const seconds = Number(secondsRaw);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) return undefined;
    if (seconds < 0 || seconds >= 60) return undefined;
    return Math.max(0, (minutes * 60 + seconds) * 1000);
  }
  const seconds = Number(trimmed);
  if (Number.isNaN(seconds)) return undefined;
  return Math.max(0, seconds * 1000);
};

export const normalizeDurationInputDraft = (value: string) => {
  const [minutesRaw, ...secondsParts] = value.trim().split(":");
  const minutes = (minutesRaw ?? "").replace(/\D/g, "").slice(0, 2);
  if (secondsParts.length === 0) return minutes;
  const seconds = secondsParts.join("").replace(/\D/g, "").slice(0, 2);
  return `${minutes}:${seconds}`;
};

export const clampDurationSeconds = (value: number) =>
  Math.min(DURATION_MAX_SECONDS, Math.max(DURATION_MIN_SECONDS, value));

export const formatDurationSeconds = (seconds: number) => formatTime(seconds * 1000);

export const durationSecondsToSlider = (seconds: number) => {
  const clamped = clampDurationSeconds(seconds);
  const ratio = Math.log(clamped / DURATION_MIN_SECONDS) / Math.log(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS);
  return Math.round(ratio * DURATION_SLIDER_STEPS);
};

export const sliderToDurationSeconds = (value: number) => {
  const ratio = Math.min(1, Math.max(0, value / DURATION_SLIDER_STEPS));
  const seconds = DURATION_MIN_SECONDS * Math.pow(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS, ratio);
  return clampDurationSeconds(Math.round(seconds));
};

/**
 * How long a persisted playback session can go un-refreshed (no active tick)
 * before a restore is no longer trusted to resume as "playing". The persist
 * effect only re-fires while the 1s timeline interval is running, so this
 * measures how long the app has been backgrounded/suspended/navigated away,
 * not how long the track itself has been playing. See HARD9-064.
 */
export const SESSION_RESTORE_STALE_MS = 5 * 60 * 1000;

/**
 * True when a restored "isPlaying" session was last confirmed alive too long
 * ago to trust that the C64 is still doing what the session claims (it may
 * have been reset/power-cycled, or the app process was suspended for hours).
 * A missing/unparseable timestamp is treated as stale (fail safe).
 */
export const isPlaybackSessionRestoreStale = (
  updatedAt: string | null | undefined,
  nowMs: number,
  staleAfterMs: number = SESSION_RESTORE_STALE_MS,
): boolean => {
  if (!updatedAt) return true;
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs > staleAfterMs;
};

export const resolvePlayTargetIndex = (playlistLength: number, currentIndex: number): number | null => {
  if (playlistLength <= 0) return null;
  if (currentIndex < 0) return 0;
  return currentIndex < playlistLength ? currentIndex : 0;
};

/**
 * Applies the "Default duration" fallback to playlist items that don't have a
 * resolved duration (songlengths/SID header/HVSC md5 lookup), without clobbering
 * items whose duration was actually resolved. An item is eligible if it has no
 * duration yet, or if its current duration was itself a prior default-fallback
 * write (durationSource: "default") — so later slider changes keep tracking
 * un-resolved items instead of freezing at the first drag. See HARD9-005.
 */
export const applyDurationOverrideToPlaylist = (playlist: PlaylistItem[], durationMs: number) => {
  const updated = playlist.map((entry) => {
    const isDefaultable =
      entry.durationSource === "default" || entry.durationMs === undefined || entry.durationMs === null;
    if (!isDefaultable) return entry;
    if (entry.durationMs === durationMs && entry.durationSource === "default") return entry;
    return { ...entry, durationMs, durationSource: "default" as const };
  });
  return updated.some((entry, index) => entry !== playlist[index]) ? updated : playlist;
};

/**
 * True when an observed saved-device selection change must locally detach
 * the Play transport instead of letting it keep firing against whatever
 * device is now selected. Saved devices + the always-visible health-badge
 * switcher let a user hop devices while Play stays mounted;
 * executeSavedDeviceSwitch mutates the C64 API singleton in place, so
 * auto-advance/Stop would otherwise launch tracks or reset/reboot the NEW
 * device while the device that was actually playing keeps going with no
 * reachable control. `previousDeviceId === null` means this is the initial
 * observation (component mount) - there is nothing to detach from yet.
 * See HARD11-002.
 */
export const shouldDetachPlaybackOnSavedDeviceSwitch = ({
  previousDeviceId,
  nextDeviceId,
  isPlaying,
  isPaused,
}: {
  previousDeviceId: string | null;
  nextDeviceId: string;
  isPlaying: boolean;
  isPaused: boolean;
}): boolean => {
  if (previousDeviceId === null || previousDeviceId === nextDeviceId) return false;
  return isPlaying || isPaused;
};

/**
 * Builds the playlist item for a live subsong switch (the subsong picker
 * shown while a multi-subsong SID is playing). Songlengths are resolved
 * per-subsong, so the previous subsong's `durationMs` must not carry over -
 * otherwise the new subsong is cut off (or overruns) at the wrong time and
 * the stale duration persists onto the playlist item. Clearing it lets
 * `playItem` re-resolve the duration for the new `songNr`. A user-entered
 * "Default duration" override (`durationSource: "default"`) is preserved
 * since it intentionally applies to any subsong. See HARD11-004.
 */
export const buildSubsongSwitchItem = (
  item: PlaylistItem,
  nextSongNr: number,
  knownSubsongCount: number | null,
): PlaylistItem => {
  const capped = knownSubsongCount ? Math.min(Math.max(1, nextSongNr), knownSubsongCount) : Math.max(1, nextSongNr);
  const preserveManualDuration = item.durationSource === "default";
  return {
    ...item,
    request: { ...item.request, songNr: capped },
    ...(preserveManualDuration ? {} : { durationMs: undefined, durationSource: null }),
  };
};

export const buildPlaylistItemId = ({
  source,
  sourceId,
  originDeviceId,
  path,
  addedAt,
}: {
  source: string;
  sourceId?: string | null;
  originDeviceId?: string | null;
  path: string;
  addedAt?: string | null;
}) => {
  const baseId = `${source}:${sourceId ?? originDeviceId ?? ""}:${path}`;
  return addedAt ? `${baseId}:${addedAt}` : baseId;
};

export type BooleanRef = { current: boolean };

export const tryAcquireSingleFlight = (ref: BooleanRef): boolean => {
  if (ref.current) return false;
  ref.current = true;
  return true;
};

export const releaseSingleFlight = (ref: BooleanRef): void => {
  ref.current = false;
};

export const parseVolumeOption = (option: string) => {
  const match = option.trim().match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

export const parseModifiedAt = (value?: string | null) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const extractAudioMixerItems = (payload: Record<string, unknown> | undefined): AudioMixerItem[] => {
  if (!payload) return [];
  const categoryData = (payload as Record<string, any>)["Audio Mixer"] ?? payload;
  const itemsData = (categoryData as Record<string, any>)?.items ?? categoryData;
  if (!itemsData || typeof itemsData !== "object") return [];
  return Object.entries(itemsData)
    .filter(([key]) => key !== "errors")
    .map(([name, config]) => {
      const normalized = normalizeConfigItem(config);
      return {
        name,
        value: normalized.value,
        options: mergeAudioMixerOptions(normalized.options, normalized.details?.presets),
      };
    });
};

export const shuffleArray = <T>(items: T[]) => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * Shuffle is implemented as a non-destructive playback-order layer: the
 * curated playlist array is never reordered. A deterministic seed produces a
 * shuffled traversal order over the current item ids; "next"/"previous" walk
 * that order and resolve back to the matching index in the curated array.
 * See HARD9-007.
 */
export const generateShuffleSeed = () => Math.floor(Math.random() * 0xffffffff);

export const seededShuffleIds = (ids: string[], seed: number) => {
  const shuffled = [...ids];
  let state = seed >>> 0;
  const nextRandom = () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const resolveShuffleOrderPosition = (playlist: PlaylistItem[], currentIndex: number, order: string[]) => {
  const currentId = currentIndex >= 0 ? playlist[currentIndex]?.id : undefined;
  const position = currentId ? order.indexOf(currentId) : -1;
  return position >= 0 ? position : 0;
};

const resolveIndexForId = (playlist: PlaylistItem[], id: string | undefined) => {
  if (id === undefined) return -1;
  return playlist.findIndex((item) => item.id === id);
};

/**
 * Resolves the next playlist index for both linear and shuffle traversal.
 * Returns null when the end is reached without repeat enabled (the caller
 * should stop instead of advancing), matching the pre-shuffle linear
 * contract.
 */
export const resolveNextPlaylistIndex = (
  playlist: PlaylistItem[],
  currentIndex: number,
  repeatEnabled: boolean,
  shuffleEnabled: boolean,
  shuffleSeed: number | null,
): number | null => {
  if (!playlist.length) return null;
  if (!shuffleEnabled || shuffleSeed === null) {
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (!repeatEnabled) return null;
      nextIndex = 0;
    }
    return nextIndex;
  }
  const order = seededShuffleIds(
    playlist.map((item) => item.id),
    shuffleSeed,
  );
  let nextPosition = resolveShuffleOrderPosition(playlist, currentIndex, order) + 1;
  if (nextPosition >= order.length) {
    if (!repeatEnabled) return null;
    nextPosition = 0;
  }
  const resolvedIndex = resolveIndexForId(playlist, order[nextPosition]);
  return resolvedIndex >= 0 ? resolvedIndex : null;
};

/**
 * Resolves the previous playlist index for both linear and shuffle
 * traversal. Always returns an index (clamps to the start of the order
 * without repeat, restarting the current track), matching the pre-shuffle
 * linear contract.
 */
export const resolvePreviousPlaylistIndex = (
  playlist: PlaylistItem[],
  currentIndex: number,
  repeatEnabled: boolean,
  shuffleEnabled: boolean,
  shuffleSeed: number | null,
): number => {
  if (!playlist.length) return 0;
  if (!shuffleEnabled || shuffleSeed === null) {
    return currentIndex > 0 ? currentIndex - 1 : repeatEnabled && playlist.length > 1 ? playlist.length - 1 : 0;
  }
  const order = seededShuffleIds(
    playlist.map((item) => item.id),
    shuffleSeed,
  );
  const currentPosition = resolveShuffleOrderPosition(playlist, currentIndex, order);
  const prevPosition =
    currentPosition > 0 ? currentPosition - 1 : repeatEnabled && order.length > 1 ? order.length - 1 : 0;
  const resolvedIndex = resolveIndexForId(playlist, order[prevPosition]);
  return resolvedIndex >= 0 ? resolvedIndex : 0;
};

// HARD12-005: derive Next/Prev enablement from the shuffle-order-aware
// resolvers so the transport buttons reflect what tapping them will actually
// do. The old linear-position test wrongly disabled Next/Prev at the
// linear-last/first track while shuffle traversal still had tracks left.
export const canAdvanceNext = (
  playlist: PlaylistItem[],
  currentIndex: number,
  repeatEnabled: boolean,
  shuffleEnabled: boolean,
  shuffleSeed: number | null,
) => resolveNextPlaylistIndex(playlist, currentIndex, repeatEnabled, shuffleEnabled, shuffleSeed) !== null;

export const canAdvancePrevious = (
  playlist: PlaylistItem[],
  currentIndex: number,
  repeatEnabled: boolean,
  shuffleEnabled: boolean,
  shuffleSeed: number | null,
) => {
  if (!playlist.length) return false;
  if (!shuffleEnabled || shuffleSeed === null) {
    return currentIndex > 0 || repeatEnabled;
  }
  const order = seededShuffleIds(
    playlist.map((item) => item.id),
    shuffleSeed,
  );
  return resolveShuffleOrderPosition(playlist, currentIndex, order) > 0 || repeatEnabled;
};
