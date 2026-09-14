/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { clearStoredPlaybackSession, readStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";
import { getPlaylistDataRepository } from "@/lib/playlistRepository/factory";
import type { PlaylistDataRepository } from "@/lib/playlistRepository/repository";
import { loadRecentlyPlayed, saveRecentlyPlayed } from "@/lib/sidRadio/recentlyPlayed";
import { SHARED_PLAYLIST_STORAGE_KEY as SHARED_PLAYLIST_ID } from "@/pages/playFiles/playFilesUtils";

const isHvscPlaylistItemId = (id: string | null | undefined) => Boolean(id?.startsWith("hvsc:"));

/**
 * Removes every trace of the Demo Mode HVSC tunes once their library has been removed: playlist
 * entries, the stored session that would resume one, and the recently played list. Only one HVSC
 * library is ever installed, so at this point every HVSC entry points at a tune that is gone.
 */
export const removeDemoTunesFromPlaylist = async (
  repository: PlaylistDataRepository = getPlaylistDataRepository(),
): Promise<number> => {
  const items = await repository.getPlaylistItems(SHARED_PLAYLIST_ID);
  const tracks = await repository.getTracksByIds(items.map((item) => item.trackId));
  const kept = items.filter((item) => tracks.get(item.trackId)?.sourceKind !== "hvsc");
  const removed = items.length - kept.length;
  if (removed > 0) await repository.replacePlaylistItems(SHARED_PLAYLIST_ID, kept);

  const session = await repository.getSession(SHARED_PLAYLIST_ID);
  const currentId = session?.currentPlaylistItemId ?? null;
  if (session && currentId && !kept.some((item) => item.playlistItemId === currentId)) {
    await repository.saveSession({ ...session, currentPlaylistItemId: null, isPlaying: false, isPaused: false });
  }
  if (isHvscPlaylistItemId(readStoredPlaybackSession()?.currentItemId)) clearStoredPlaybackSession();

  const recents = loadRecentlyPlayed();
  const keptRecents = recents.filter((entry) => entry.source !== undefined && entry.source !== "hvsc");
  if (keptRecents.length !== recents.length) saveRecentlyPlayed(keptRecents);

  addLog("info", "Removed the Demo Mode tunes from the playlist and recently played", {
    playlistEntries: removed,
    recentlyPlayed: recents.length - keptRecents.length,
  });
  return removed;
};
