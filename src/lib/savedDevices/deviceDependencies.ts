import { buildLocalStorageKey } from "@/generated/variant";
import { addErrorLog } from "@/lib/logging";
import type { DiskEntry } from "@/lib/disks/diskTypes";
import type { PlaylistItemRecord, TrackRecord } from "@/lib/playlistRepository";

export type SavedDeviceDependencySummary = {
  diskCount: number;
  playlistItemCount: number;
  totalCount: number;
};

type LocalDiskLibraryState = {
  disks?: DiskEntry[] | null;
};

type LocalPlaylistRepositoryState = {
  tracks?: Record<string, TrackRecord> | null;
  playlistItemsByPlaylistId?: Record<string, PlaylistItemRecord[]> | null;
};

const DISK_LIBRARY_PREFIX = `${buildLocalStorageKey("disk_library")}:`;
const PLAYLIST_REPOSITORY_STORAGE_KEY = buildLocalStorageKey("playlist_repo:v1");
const PLAYLIST_REPOSITORY_DB_NAME = "c64u-playlist-repository";
const PLAYLIST_REPOSITORY_DB_VERSION = 1;
const PLAYLIST_REPOSITORY_STORE = "state";

const countDiskReferences = (deviceId: string) => {
  if (typeof localStorage === "undefined") return 0;

  let total = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(DISK_LIBRARY_PREFIX)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as LocalDiskLibraryState | null;
      total +=
        parsed?.disks?.filter(
          (disk) => disk.origin?.sourceKind === "ultimate" && disk.origin.originDeviceId === deviceId,
        ).length ?? 0;
    } catch (error) {
      addErrorLog("Saved device dependency scan failed", {
        scope: "disk-library",
        storageKey: key,
        error: (error as Error).message,
      });
    }
  }

  return total;
};

const countPlaylistReferencesFromState = (state: LocalPlaylistRepositoryState | null | undefined, deviceId: string) => {
  if (!state) return 0;

  const matchingTrackIds = new Set(
    Object.values(state.tracks ?? {})
      .filter((track) => track.origin?.sourceKind === "ultimate" && track.origin.originDeviceId === deviceId)
      .map((track) => track.trackId),
  );

  if (!matchingTrackIds.size) return 0;

  return Object.values(state.playlistItemsByPlaylistId ?? {}).reduce((total, items) => {
    return total + items.filter((item) => matchingTrackIds.has(item.trackId)).length;
  }, 0);
};

const countLocalStoragePlaylistReferences = (deviceId: string) => {
  if (typeof localStorage === "undefined") return 0;

  const raw = localStorage.getItem(PLAYLIST_REPOSITORY_STORAGE_KEY);
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw) as LocalPlaylistRepositoryState | null;
    return countPlaylistReferencesFromState(parsed, deviceId);
  } catch (error) {
    addErrorLog("Saved device dependency scan failed", {
      scope: "playlist-repository-local-storage",
      storageKey: PLAYLIST_REPOSITORY_STORAGE_KEY,
      error: (error as Error).message,
    });
    return 0;
  }
};

const countIndexedDbPlaylistReferences = async (deviceId: string) => {
  if (typeof indexedDB === "undefined") return 0;

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PLAYLIST_REPOSITORY_DB_NAME, PLAYLIST_REPOSITORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PLAYLIST_REPOSITORY_STORE)) {
        db.createObjectStore(PLAYLIST_REPOSITORY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });

  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(PLAYLIST_REPOSITORY_STORE, "readonly");
      const store = transaction.objectStore(PLAYLIST_REPOSITORY_STORE);
      const request = store.openCursor();
      const matchingTrackIds = new Set<string>();
      const playlistItems: PlaylistItemRecord[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(playlistItems.filter((item) => matchingTrackIds.has(item.trackId)).length);
          return;
        }

        const key = typeof cursor.key === "string" ? cursor.key : "";
        if (key.startsWith("track:")) {
          const track = cursor.value as TrackRecord | null;
          if (track?.origin?.sourceKind === "ultimate" && track.origin.originDeviceId === deviceId) {
            matchingTrackIds.add(track.trackId);
          }
        } else if (key.startsWith("playlist-item:")) {
          const playlistItem = cursor.value as PlaylistItemRecord | null;
          if (playlistItem) {
            playlistItems.push(playlistItem);
          }
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });
  } catch (error) {
    addErrorLog("Saved device dependency scan failed", {
      scope: "playlist-repository-indexeddb",
      dbName: PLAYLIST_REPOSITORY_DB_NAME,
      error: (error as Error).message,
    });
    return 0;
  } finally {
    database.close();
  }
};

export const getSavedDeviceDependencySummary = async (deviceId: string): Promise<SavedDeviceDependencySummary> => {
  const diskCount = countDiskReferences(deviceId);
  const playlistItemCount =
    typeof indexedDB !== "undefined"
      ? await countIndexedDbPlaylistReferences(deviceId)
      : countLocalStoragePlaylistReferences(deviceId);

  return {
    diskCount,
    playlistItemCount,
    totalCount: diskCount + playlistItemCount,
  };
};
