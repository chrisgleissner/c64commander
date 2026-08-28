/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What just played.
 *
 * A station is endless and strictly one-way. A tune goes by, you think "what *was* that", and it is
 * gone: Liked Tunes only holds what you reacted to in time, and the playlist has already moved on.
 * This is the way back — a short list of what has been heard, newest first, with the same two
 * actions the search results already offer.
 *
 * Deliberately small and deliberately not a feature of its own. It records what the transport
 * already knows, keeps only enough to answer "what was that", and hands its rows to the same
 * component the search uses, so there is no second idea of what a result is.
 */

import { addErrorLog } from "@/lib/logging";

/** What kind of thing was opened. v1 held tunes only; the Home Recent tile shows all three. */
export type RecentlyPlayedCategory = "sid" | "disk" | "program";

/** One item that has been opened, in the shape the row draws. */
export type RecentlyPlayedEntry = {
  /**
   * Identity, and what the row is reopened by. For a tune this is the HVSC virtual path; for a disk
   * or a program it is the source path the launcher takes. The same item twice is one entry.
   */
  virtualPath: string;
  title: string;
  author: string | null;
  folder: string;
  /** Absent on a v1 entry, which is why the migration writes "sid" onto every one of them. */
  category: RecentlyPlayedCategory;
  /** Where the item came from, when it is not the HVSC archive — a local folder, a device path. */
  sourceId?: string;
  songNr?: number;
  subsongCount?: number;
  durationMs?: number;
  /** When it was last opened, so the list can be ordered and shown newest first. */
  playedAt: number;
};

/**
 * How many to keep.
 *
 * Long enough to cover a listening session's worth of "what was that", short enough that the list
 * stays scannable and the stored blob stays trivial. Past a couple of dozen this stops being a way
 * back and starts being a second playlist, which is not what it is for.
 */
export const RECENTLY_PLAYED_LIMIT = 25;

const STORAGE_KEY = "c64u_recently_played:v2";
/** Read once and migrated: every v1 entry was a tune, so each gets category "sid". */
const LEGACY_STORAGE_KEY = "c64u_recently_played:v1";

const folderOf = (virtualPath: string): string => {
  const index = virtualPath.lastIndexOf("/");
  return index <= 0 ? "/" : virtualPath.slice(0, index);
};

/**
 * Fold a newly-heard tune into the list.
 *
 * Pure, so the ordering and de-duplication rules are testable without storage. Hearing something
 * again moves it to the top rather than adding a second row: the question this answers is "what was
 * that", and the same tune is the same answer however many times it has come round.
 */
export const withRecentlyPlayed = (
  entries: readonly RecentlyPlayedEntry[],
  entry: RecentlyPlayedEntry,
  limit = RECENTLY_PLAYED_LIMIT,
): RecentlyPlayedEntry[] => {
  const withoutDuplicate = entries.filter((existing) => existing.virtualPath !== entry.virtualPath);
  return [entry, ...withoutDuplicate].slice(0, Math.max(1, limit));
};

/** Build an entry from what the transport knows about the track it just started. */
export const toRecentlyPlayedEntry = (input: {
  virtualPath: string;
  title: string;
  author?: string | null;
  category?: RecentlyPlayedCategory;
  sourceId?: string;
  songNr?: number;
  subsongCount?: number;
  durationMs?: number;
  playedAt?: number;
}): RecentlyPlayedEntry => ({
  virtualPath: input.virtualPath,
  title: input.title,
  author: input.author ?? null,
  folder: folderOf(input.virtualPath),
  category: input.category ?? "sid",
  ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
  ...(input.songNr === undefined ? {} : { songNr: input.songNr }),
  ...(input.subsongCount === undefined ? {} : { subsongCount: input.subsongCount }),
  ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
  playedAt: input.playedAt ?? Date.now(),
});

const CATEGORIES = new Set<string>(["sid", "disk", "program"]);

/**
 * Reads one stored row, filling in what v1 did not have. Filtered rather than trusted: this is read
 * at startup, and one malformed row from an older build must not take the list with it.
 */
const parseEntry = (value: unknown): RecentlyPlayedEntry | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<RecentlyPlayedEntry>;
  if (typeof row.virtualPath !== "string") return null;
  return {
    virtualPath: row.virtualPath,
    title: typeof row.title === "string" ? row.title : row.virtualPath,
    author: typeof row.author === "string" ? row.author : null,
    folder: typeof row.folder === "string" ? row.folder : folderOf(row.virtualPath),
    // Absent on every v1 row, which held tunes only.
    category: typeof row.category === "string" && CATEGORIES.has(row.category) ? row.category : "sid",
    ...(typeof row.sourceId === "string" ? { sourceId: row.sourceId } : {}),
    ...(typeof row.songNr === "number" ? { songNr: row.songNr } : {}),
    ...(typeof row.subsongCount === "number" ? { subsongCount: row.subsongCount } : {}),
    ...(typeof row.durationMs === "number" ? { durationMs: row.durationMs } : {}),
    playedAt: typeof row.playedAt === "number" ? row.playedAt : 0,
  };
};

const readRows = (key: string): RecentlyPlayedEntry[] => {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.map(parseEntry).filter((entry): entry is RecentlyPlayedEntry => entry !== null);
};

export const saveRecentlyPlayed = (entries: readonly RecentlyPlayedEntry[]): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    // A device that cannot persist this still has the list for the rest of the session.
    addErrorLog("Failed to persist recently played", { error: (error as Error).message });
  }
};

export const loadRecentlyPlayed = (): RecentlyPlayedEntry[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const current = readRows(STORAGE_KEY);
    if (localStorage.getItem(STORAGE_KEY) !== null) return current;

    // v1 -> v2, once. The legacy key is removed as soon as it has been copied, so a row the user
    // later removes cannot come back on the next read.
    const legacy = readRows(LEGACY_STORAGE_KEY);
    if (localStorage.getItem(LEGACY_STORAGE_KEY) === null) return current;
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    saveRecentlyPlayed(legacy);
    return legacy;
  } catch (error) {
    addErrorLog("Failed to read recently played", { error: (error as Error).message });
    return [];
  }
};

export const clearRecentlyPlayed = (): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
};
