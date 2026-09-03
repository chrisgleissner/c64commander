/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { StoredPlaybackSession } from "@/pages/playFiles/types";

/**
 * The one place the playback session (playlist, current tune, position, shuffle
 * and repeat) is stored and read. Distinct from `playbackSessionPersistence`,
 * which holds the device's volume and mute snapshot for the restore on stop.
 *
 * localStorage, not sessionStorage: on a phone the OS ends the process while the
 * app is backgrounded, and sessionStorage goes with it, so the Home "Last" tile
 * and the "Resume session" search action were empty after every such kill even
 * though the playlist itself (localStorage/IndexedDB) survived. See HARD27-032.
 * A session too old to still describe the machine is not resumed as playing —
 * `isPlaybackSessionRestoreStale` downgrades it to paused (HARD9-064) — so the
 * store itself keeps the record until playback stops.
 */
export const PLAYBACK_SESSION_KEY = "c64u_playback_session:v1";

const parseSession = (raw: string | null): StoredPlaybackSession | null => {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as StoredPlaybackSession;
};

/**
 * Reads the stored session, migrating one left in sessionStorage by a build
 * from before HARD27-032 so an in-place upgrade does not drop a live session.
 */
export const readStoredPlaybackSession = (): StoredPlaybackSession | null => {
  try {
    if (typeof localStorage !== "undefined") {
      const session = parseSession(localStorage.getItem(PLAYBACK_SESSION_KEY));
      if (session) return session;
    }
    if (typeof sessionStorage === "undefined") return null;
    const legacyRaw = sessionStorage.getItem(PLAYBACK_SESSION_KEY);
    const legacy = parseSession(legacyRaw);
    if (!legacy) return null;
    sessionStorage.removeItem(PLAYBACK_SESSION_KEY);
    if (typeof localStorage !== "undefined" && legacyRaw) {
      localStorage.setItem(PLAYBACK_SESSION_KEY, legacyRaw);
    }
    return legacy;
  } catch (error) {
    addErrorLog("Failed to read the stored playback session", { error: (error as Error).message });
    return null;
  }
};

export const writeStoredPlaybackSession = (session: StoredPlaybackSession): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify(session));
    // A pre-HARD27-032 entry left behind would win the migration read after the
    // next stop clears localStorage, resurrecting a session the user ended.
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PLAYBACK_SESSION_KEY);
  } catch (error) {
    addErrorLog("Failed to persist playback session", {
      playlistStorageKey: session.playlistKey,
      error: (error as Error).message,
    });
  }
};

export const clearStoredPlaybackSession = (): void => {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(PLAYBACK_SESSION_KEY);
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PLAYBACK_SESSION_KEY);
  } catch (error) {
    addErrorLog("Failed to clear the stored playback session", { error: (error as Error).message });
  }
};
