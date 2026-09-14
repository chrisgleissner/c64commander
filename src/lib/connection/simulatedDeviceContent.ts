/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getConnectionSnapshot, subscribeConnection, type ConnectionState } from "@/lib/connection/connectionManager";
import { addLog } from "@/lib/logging";
import type { PlaylistDataRepository } from "@/lib/playlistRepository/repository";
import type { DeviceBoundContentOrigin } from "@/lib/savedDevices/deviceBoundOrigin";

type OriginLike = Pick<DeviceBoundContentOrigin, "originDeviceLastKnownUniqueId"> | null | undefined;

/**
 * Files added from Demo Mode's simulated device were attributed to the saved real device, so after
 * Demo Mode they stayed in the playlist and disk library, pointing at paths the real device does not
 * have. They now carry the simulated device's MOCK- id and are removed when Demo Mode ends.
 */
export const isSimulatedDeviceOrigin = (origin: OriginLike) =>
  Boolean(origin?.originDeviceLastKnownUniqueId?.startsWith("MOCK-"));

const listeners = new Set<() => void>();

export const subscribeSimulatedDeviceContentRemoved = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const removeSimulatedDeviceContent = async (repository?: PlaylistDataRepository): Promise<void> => {
  // Loaded when Demo Mode ends rather than imported: imported, the playlist repository and the disk store came
  // into the startup bundle with this module and took it past its 250 KB budget.
  const [{ getPlaylistDataRepository }, { SHARED_PLAYLIST_STORAGE_KEY: SHARED_PLAYLIST_ID }, diskStore, sessionStore] =
    await Promise.all([
      import("@/lib/playlistRepository/factory"),
      import("@/pages/playFiles/playFilesUtils"),
      import("@/lib/disks/diskStore"),
      import("@/lib/playback/playbackSessionStore"),
    ]);
  repository ??= getPlaylistDataRepository();
  const items = await repository.getPlaylistItems(SHARED_PLAYLIST_ID);
  const tracks = await repository.getTracksByIds(items.map((item) => item.trackId));
  const kept = items.filter((item) => !isSimulatedDeviceOrigin(tracks.get(item.trackId)?.origin));
  if (kept.length !== items.length) await repository.replacePlaylistItems(SHARED_PLAYLIST_ID, kept);

  const session = await repository.getSession(SHARED_PLAYLIST_ID);
  const currentId = session?.currentPlaylistItemId ?? null;
  if (session && currentId && !kept.some((item) => item.playlistItemId === currentId)) {
    await repository.saveSession({ ...session, currentPlaylistItemId: null, isPlaying: false, isPaused: false });
  }
  const storedItemId = sessionStore.readStoredPlaybackSession()?.currentItemId;
  if (storedItemId && items.some((item) => item.playlistItemId === storedItemId && !kept.includes(item))) {
    sessionStore.clearStoredPlaybackSession();
  }

  const library = diskStore.loadDiskLibrary(diskStore.SHARED_DISK_LIBRARY_ID);
  const disks = library.disks.filter((disk) => !isSimulatedDeviceOrigin(disk.origin));
  if (disks.length !== library.disks.length) diskStore.saveDiskLibrary(diskStore.SHARED_DISK_LIBRARY_ID, { disks });

  listeners.forEach((listener) => listener());
  addLog("info", "Removed the simulated device's files after Demo Mode", {
    playlistEntries: items.length - kept.length,
    disks: library.disks.length - disks.length,
  });
};

/** Watches the connection and clears the simulated device's files once Demo Mode has ended. */
export const installSimulatedDeviceContentCleanup = () => {
  let settledState: ConnectionState = getConnectionSnapshot().state;
  const unsubscribe = subscribeConnection(() => {
    const { state } = getConnectionSnapshot();
    if (state === "DISCOVERING" || state === "UNKNOWN" || state === settledState) return;
    const leftDemoMode = settledState === "DEMO_ACTIVE";
    settledState = state;
    if (leftDemoMode) void removeSimulatedDeviceContent();
  });
  return () => {
    unsubscribe();
  };
};
