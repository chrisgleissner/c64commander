/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from "@capacitor/filesystem";
import type { MediaEntry } from "@/lib/media-index";
import { addLog } from "@/lib/logging";
import type { InMemorySongLengthSnapshot } from "@/lib/songlengths";
import type { HvscSidMetadata, HvscTrackSubsong } from "./hvscTypes";
import { resolveLibraryPath } from "./hvscFilesystem";
import { runWithHvscPerfScope } from "./hvscPerformance";

const STORAGE_PATH = "hvsc/index/hvsc-browse-index-v1.json";
const STORAGE_KEY = "c64u_hvsc_browse_index:v1";
const MEDIA_INDEX_STORAGE_PATH = "hvsc/index/media-index-v2.json";
const MEDIA_INDEX_STORAGE_KEY = "c64u_media_index:v1";
const SCHEMA_VERSION = 2;
const MAX_PERSISTED_FULL_SNAPSHOT_SONGS = 10000;

type PersistedMediaIndexSnapshot = {
  version: number;
  updatedAt: string;
  entries: Array<{
    path: string;
    name: string;
    type: "sid";
    durationSeconds?: number | null;
  }>;
};

export type HvscMetadataStatus = "seeded" | "queued" | "hydrating" | "hydrated" | "error";

export type HvscBrowseIndexedSong = {
  virtualPath: string;
  fileName: string;
  displayTitleSeed?: string | null;
  displayAuthorSeed?: string | null;
  canonicalTitle?: string | null;
  canonicalAuthor?: string | null;
  released?: string | null;
  durationSeconds?: number | null;
  durationsSeconds?: number[] | null;
  subsongCount?: number | null;
  defaultSong?: number | null;
  metadataStatus?: HvscMetadataStatus | null;
  metadataUpdatedAt?: string | null;
  searchTextSeed?: string | null;
  searchTextFull?: string | null;
  sidMetadata?: HvscSidMetadata | null;
  trackSubsongs?: HvscTrackSubsong[] | null;
};

export type HvscBrowseFolderRow = {
  path: string;
  folders: string[];
  songs: string[];
};

export type HvscBrowseIndexSnapshot = {
  schemaVersion: number;
  updatedAt: string;
  songs: Record<string, HvscBrowseIndexedSong>;
  folders: Record<string, HvscBrowseFolderRow>;
};

export const getHvscDisplayTitle = (
  song: Pick<HvscBrowseIndexedSong, "fileName" | "displayTitleSeed" | "canonicalTitle">,
) => normalizeDisplayValue(song.canonicalTitle) ?? normalizeDisplayValue(song.displayTitleSeed) ?? song.fileName;

export const getHvscDisplayAuthor = (song: Pick<HvscBrowseIndexedSong, "displayAuthorSeed" | "canonicalAuthor">) =>
  normalizeDisplayValue(song.canonicalAuthor) ?? normalizeDisplayValue(song.displayAuthorSeed) ?? null;

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);
const normalizeFolderPath = (path: string) => {
  const normalized = normalizePath(path || "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
};

const normalizeDisplayValue = (value: string | null | undefined) =>
  value?.replace(/_/g, " ").replace(/\s+/g, " ").trim() || null;

const stripSidExtension = (value: string) => value.replace(/\.sid$/i, "");

const deriveSeedTitle = (fileName: string) => normalizeDisplayValue(stripSidExtension(fileName)) ?? fileName;

const deriveSeedAuthor = (virtualPath: string) => {
  const segments = normalizePath(virtualPath).split("/").filter(Boolean);
  const musicianIndex = segments.findIndex((segment) => segment.toUpperCase() === "MUSICIANS");
  if (musicianIndex < 0 || musicianIndex + 2 >= segments.length) return null;
  const rawAuthor = segments[musicianIndex + 2];
  const authorTokens = rawAuthor
    .split("_")
    .map((token) => token.trim())
    .filter(Boolean);
  if (authorTokens.length > 1) {
    return normalizeDisplayValue(authorTokens.reverse().join(" "));
  }
  return normalizeDisplayValue(rawAuthor);
};

const buildSeedSearchText = (
  song: Pick<HvscBrowseIndexedSong, "virtualPath" | "fileName" | "displayTitleSeed" | "displayAuthorSeed">,
) =>
  [song.virtualPath, song.fileName, song.displayTitleSeed, song.displayAuthorSeed]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

const buildFullSearchText = (
  song: Pick<
    HvscBrowseIndexedSong,
    | "virtualPath"
    | "fileName"
    | "displayTitleSeed"
    | "displayAuthorSeed"
    | "canonicalTitle"
    | "canonicalAuthor"
    | "released"
  >,
) =>
  [
    song.virtualPath,
    song.fileName,
    song.displayTitleSeed,
    song.displayAuthorSeed,
    song.canonicalTitle,
    song.canonicalAuthor,
    song.released,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

const createSeededSong = (
  virtualPath: string,
  durationsSeconds: number[] | null | undefined,
): HvscBrowseIndexedSong => {
  const normalizedPath = normalizePath(virtualPath);
  const fileName = getFileName(normalizedPath);
  const normalizedDurations = durationsSeconds?.length ? [...durationsSeconds] : null;
  const displayTitleSeed = deriveSeedTitle(fileName);
  const displayAuthorSeed = deriveSeedAuthor(normalizedPath);
  const song: HvscBrowseIndexedSong = {
    virtualPath: normalizedPath,
    fileName,
    displayTitleSeed,
    displayAuthorSeed,
    canonicalTitle: null,
    canonicalAuthor: null,
    released: null,
    durationSeconds: normalizedDurations?.[0] ?? null,
    durationsSeconds: normalizedDurations,
    subsongCount: normalizedDurations?.length ?? null,
    defaultSong: 1,
    metadataStatus: "seeded",
    metadataUpdatedAt: null,
    sidMetadata: null,
    trackSubsongs: normalizedDurations?.length
      ? normalizedDurations.map((_, index) => ({
        songNr: index + 1,
        isDefault: index === 0,
      }))
      : null,
  };
  song.searchTextSeed = buildSeedSearchText(song);
  song.searchTextFull = buildFullSearchText(song);
  return song;
};

const encodeUtf8Base64 = (value: string) => {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  return Buffer.from(value, "utf-8").toString("base64");
};

const decodeUtf8Base64 = (value: string) => {
  try {
    if (typeof atob === "function") {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return value;
  }
};

const hashPath = (value: string) =>
  Math.abs(Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0));

const getParentFolder = (virtualPath: string) => {
  const normalized = normalizePath(virtualPath);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.substring(0, index);
};

const getFileName = (virtualPath: string) => {
  const normalized = normalizePath(virtualPath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.substring(index + 1) : normalized;
};

const toIndexedSong = (entry: MediaEntry): HvscBrowseIndexedSong => ({
  virtualPath: normalizePath(entry.path),
  fileName: entry.name,
  displayTitleSeed: deriveSeedTitle(entry.name),
  displayAuthorSeed: deriveSeedAuthor(entry.path),
  canonicalTitle: null,
  canonicalAuthor: null,
  released: null,
  durationSeconds: entry.durationSeconds ?? null,
  durationsSeconds: entry.durationSeconds != null ? [entry.durationSeconds] : null,
  subsongCount: entry.durationSeconds != null ? 1 : null,
  defaultSong: 1,
  metadataStatus: entry.durationSeconds != null ? "seeded" : null,
  metadataUpdatedAt: null,
  searchTextSeed: [entry.path, entry.name, deriveSeedTitle(entry.name), deriveSeedAuthor(entry.path)]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase(),
  searchTextFull: [entry.path, entry.name, deriveSeedTitle(entry.name), deriveSeedAuthor(entry.path)]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase(),
  sidMetadata: null,
  trackSubsongs: entry.durationSeconds != null ? [{ songNr: 1, isDefault: true }] : null,
});

const buildFoldersFromSongs = (songs: Record<string, HvscBrowseIndexedSong>) => {
  const folderMap = new Map<string, { folders: Set<string>; songs: Set<string> }>();
  const ensureFolder = (path: string) => {
    const normalized = normalizeFolderPath(path);
    const current = folderMap.get(normalized);
    if (current) return current;
    const next = { folders: new Set<string>(), songs: new Set<string>() };
    folderMap.set(normalized, next);
    return next;
  };

  ensureFolder("/");
  Object.values(songs).forEach((song) => {
    const normalizedSongPath = normalizePath(song.virtualPath);
    const segments = normalizedSongPath.split("/").filter(Boolean);
    let currentPath = "/";
    for (let index = 0; index < segments.length - 1; index += 1) {
      const folderName = segments[index];
      const parent = ensureFolder(currentPath);
      const nextPath = normalizeFolderPath(`${currentPath === "/" ? "" : currentPath}/${folderName}`);
      parent.folders.add(nextPath);
      ensureFolder(nextPath);
      currentPath = nextPath;
    }
    ensureFolder(currentPath).songs.add(normalizedSongPath);
  });

  const folders: Record<string, HvscBrowseFolderRow> = {};
  folderMap.forEach((value, path) => {
    folders[path] = {
      path,
      folders: Array.from(value.folders).sort((a, b) => a.localeCompare(b)),
      songs: Array.from(value.songs).sort((a, b) => a.localeCompare(b)),
    };
  });

  return folders;
};

export const createEmptyHvscBrowseIndexSnapshot = (): HvscBrowseIndexSnapshot => ({
  schemaVersion: SCHEMA_VERSION,
  updatedAt: new Date().toISOString(),
  songs: {},
  folders: {
    "/": {
      path: "/",
      folders: [],
      songs: [],
    },
  },
});

const normalizeSnapshot = (snapshot: HvscBrowseIndexSnapshot | null) => {
  if (!snapshot) return createEmptyHvscBrowseIndexSnapshot();
  if (snapshot.schemaVersion !== SCHEMA_VERSION) return null;
  const songs: Record<string, HvscBrowseIndexedSong> = {};
  Object.entries(snapshot.songs ?? {}).forEach(([path, song]) => {
    const normalizedPath = normalizePath(path);
    const fileName = song.fileName || getFileName(normalizedPath);
    const normalizedDurations = song.durationsSeconds?.length
      ? [...song.durationsSeconds]
      : song.durationSeconds != null
        ? [song.durationSeconds]
        : null;
    const seededSong = createSeededSong(normalizedPath, normalizedDurations);
    songs[normalizedPath] = {
      ...seededSong,
      fileName,
      displayTitleSeed: normalizeDisplayValue(song.displayTitleSeed) ?? seededSong.displayTitleSeed,
      displayAuthorSeed: normalizeDisplayValue(song.displayAuthorSeed) ?? seededSong.displayAuthorSeed,
      canonicalTitle: normalizeDisplayValue(song.canonicalTitle),
      canonicalAuthor: normalizeDisplayValue(song.canonicalAuthor),
      released: song.released ?? null,
      durationSeconds: song.durationSeconds ?? seededSong.durationSeconds ?? null,
      durationsSeconds: normalizedDurations,
      subsongCount: song.subsongCount ?? normalizedDurations?.length ?? seededSong.subsongCount ?? null,
      defaultSong: song.defaultSong ?? song.sidMetadata?.startSong ?? seededSong.defaultSong ?? 1,
      metadataStatus: song.metadataStatus ?? (song.sidMetadata ? "hydrated" : seededSong.metadataStatus),
      metadataUpdatedAt: song.metadataUpdatedAt ?? null,
      sidMetadata: song.sidMetadata ?? null,
      trackSubsongs:
        song.trackSubsongs ??
        normalizedDurations?.map((_, index) => ({
          songNr: index + 1,
          isDefault: index + 1 === (song.defaultSong ?? song.sidMetadata?.startSong ?? 1),
        })) ??
        seededSong.trackSubsongs,
    };
    songs[normalizedPath].searchTextSeed = song.searchTextSeed ?? buildSeedSearchText(songs[normalizedPath]);
    songs[normalizedPath].searchTextFull = song.searchTextFull ?? buildFullSearchText(songs[normalizedPath]);
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: snapshot.updatedAt,
    songs,
    folders: buildFoldersFromSongs(songs),
  } satisfies HvscBrowseIndexSnapshot;
};

const parseSnapshot = (raw: string | null) => {
  if (!raw) return null;
  try {
    return normalizeSnapshot(JSON.parse(raw) as HvscBrowseIndexSnapshot);
  } catch {
    return null;
  }
};

const parseMediaIndexSnapshot = (raw: string | null) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedMediaIndexSnapshot;
    if (!Array.isArray(parsed.entries)) return null;
    return buildHvscBrowseIndexFromEntries(
      parsed.entries
        .filter((entry) => entry.type === "sid")
        .map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: "sid" as const,
          durationSeconds: entry.durationSeconds ?? null,
        })),
    );
  } catch {
    return null;
  }
};

const buildPersistedMediaIndexSnapshot = (snapshot: HvscBrowseIndexSnapshot): PersistedMediaIndexSnapshot => ({
  version: 1,
  updatedAt: snapshot.updatedAt,
  entries: Object.values(snapshot.songs).map((song) => ({
    path: song.virtualPath,
    name: song.fileName,
    type: "sid" as const,
    durationSeconds: song.durationSeconds ?? null,
  })),
});

const shouldPersistFullSnapshot = (snapshot: HvscBrowseIndexSnapshot) =>
  Object.keys(snapshot.songs).length <= MAX_PERSISTED_FULL_SNAPSHOT_SONGS;

const readFilesystemSnapshot = async () => {
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      path: STORAGE_PATH,
    });
    return parseSnapshot(decodeUtf8Base64(result.data));
  } catch {
    return null;
  }
};

const readFilesystemMediaIndexSnapshot = async () => {
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      path: MEDIA_INDEX_STORAGE_PATH,
    });
    return parseMediaIndexSnapshot(decodeUtf8Base64(result.data));
  } catch {
    return null;
  }
};

const deleteFilesystemFullSnapshot = async () => {
  try {
    await Filesystem.deleteFile({
      directory: Directory.Data,
      path: STORAGE_PATH,
    });
  } catch {
    // Best effort cleanup of stale full snapshots.
  }
};

export const clearHvscBrowseIndexSnapshot = async () => {
  if (typeof window !== "undefined") {
    try {
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: STORAGE_PATH,
      });
    } catch (error) {
      addLog("warn", "Failed to delete HVSC browse snapshot", {
        path: STORAGE_PATH,
        error: (error as Error).message,
      });
    }
    try {
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: MEDIA_INDEX_STORAGE_PATH,
      });
    } catch (error) {
      addLog("warn", "Failed to delete HVSC media snapshot", {
        path: MEDIA_INDEX_STORAGE_PATH,
        error: (error as Error).message,
      });
    }
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(MEDIA_INDEX_STORAGE_KEY);
  }
};

const writeFilesystemSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  await Filesystem.mkdir({
    directory: Directory.Data,
    path: "hvsc/index",
    recursive: true,
  });
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: STORAGE_PATH,
    data: encodeUtf8Base64(JSON.stringify(snapshot)),
  });
};

const writeFilesystemMediaIndexSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  const mediaIndexSnapshot = buildPersistedMediaIndexSnapshot(snapshot);
  await Filesystem.mkdir({
    directory: Directory.Data,
    path: "hvsc/index",
    recursive: true,
  });
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: MEDIA_INDEX_STORAGE_PATH,
    data: encodeUtf8Base64(JSON.stringify(mediaIndexSnapshot)),
  });
};

const readLocalStorageSnapshot = () => {
  if (typeof localStorage === "undefined") return null;
  return parseSnapshot(localStorage.getItem(STORAGE_KEY));
};

const readLocalStorageMediaIndexSnapshot = () => {
  if (typeof localStorage === "undefined") return null;
  return parseMediaIndexSnapshot(localStorage.getItem(MEDIA_INDEX_STORAGE_KEY));
};

const deleteLocalStorageFullSnapshot = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
};

const writeLocalStorageSnapshot = (snapshot: HvscBrowseIndexSnapshot) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

const writeLocalStorageMediaIndexSnapshot = (snapshot: HvscBrowseIndexSnapshot) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MEDIA_INDEX_STORAGE_KEY, JSON.stringify(buildPersistedMediaIndexSnapshot(snapshot)));
};

export const loadHvscBrowseIndexSnapshot = async () => {
  return runWithHvscPerfScope(
    "browse:load-snapshot",
    async () => {
      if (typeof window !== "undefined") {
        const filesystemSnapshot = await readFilesystemSnapshot();
        if (filesystemSnapshot) return filesystemSnapshot;
        const filesystemMediaIndexSnapshot = await readFilesystemMediaIndexSnapshot();
        if (filesystemMediaIndexSnapshot) return filesystemMediaIndexSnapshot;
        return readLocalStorageSnapshot() ?? readLocalStorageMediaIndexSnapshot();
      }
      return readLocalStorageSnapshot() ?? readLocalStorageMediaIndexSnapshot();
    },
    {
      platform: typeof window !== "undefined" ? "browser" : "node",
    },
  );
};

export const saveHvscBrowseIndexSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  const normalized: HvscBrowseIndexSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    songs: snapshot.songs,
    folders: buildFoldersFromSongs(snapshot.songs),
  };
  const persistFullSnapshot = shouldPersistFullSnapshot(normalized);
  if (typeof window !== "undefined") {
    try {
      await writeFilesystemMediaIndexSnapshot(normalized);
      if (persistFullSnapshot) {
        await writeFilesystemSnapshot(normalized);
      } else {
        await deleteFilesystemFullSnapshot();
        addLog("info", "HVSC browse snapshot persistence downgraded to compact media index", {
          path: STORAGE_PATH,
          songCount: Object.keys(normalized.songs).length,
          maxFullSnapshotSongs: MAX_PERSISTED_FULL_SNAPSHOT_SONGS,
        });
      }
      return;
    } catch {
      writeLocalStorageMediaIndexSnapshot(normalized);
      if (persistFullSnapshot) {
        writeLocalStorageSnapshot(normalized);
      } else if (typeof localStorage !== "undefined") {
        deleteLocalStorageFullSnapshot();
        addLog("info", "HVSC browse snapshot localStorage persistence downgraded to compact media index", {
          storageKey: STORAGE_KEY,
          songCount: Object.keys(normalized.songs).length,
          maxFullSnapshotSongs: MAX_PERSISTED_FULL_SNAPSHOT_SONGS,
        });
      }
      return;
    }
  }
  writeLocalStorageMediaIndexSnapshot(normalized);
  if (persistFullSnapshot) {
    writeLocalStorageSnapshot(normalized);
  } else {
    deleteLocalStorageFullSnapshot();
  }
};

export const buildHvscBrowseIndexFromEntries = (entries: MediaEntry[]): HvscBrowseIndexSnapshot => {
  const songs = Object.fromEntries(
    entries.map((entry) => {
      const song = toIndexedSong(entry);
      return [song.virtualPath, song];
    }),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    songs,
    folders: buildFoldersFromSongs(songs),
  };
};

export const buildHvscBrowseIndexFromSonglengthSnapshot = (
  snapshot: InMemorySongLengthSnapshot,
): HvscBrowseIndexSnapshot => {
  const songs = Object.fromEntries(
    Array.from(snapshot.pathToSeconds.entries()).map(([virtualPath, durationsSeconds]) => {
      const song = createSeededSong(virtualPath, durationsSeconds);
      return [song.virtualPath, song];
    }),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    songs,
    folders: buildFoldersFromSongs(songs),
  };
};

export const updateHvscBrowseSong = (
  snapshot: HvscBrowseIndexSnapshot,
  virtualPath: string,
  updates: Partial<HvscBrowseIndexedSong>,
) => {
  const normalizedPath = normalizePath(virtualPath);
  const existing = snapshot.songs[normalizedPath];
  if (!existing) {
    throw new Error(`HVSC browse song not found: ${normalizedPath}`);
  }
  const durationsSeconds = updates.durationsSeconds?.length
    ? [...updates.durationsSeconds]
    : updates.durationSeconds != null
      ? [updates.durationSeconds]
      : existing.durationsSeconds?.length
        ? [...existing.durationsSeconds]
        : null;
  const next: HvscBrowseIndexedSong = {
    ...existing,
    ...updates,
    virtualPath: normalizedPath,
    fileName: updates.fileName || existing.fileName,
    displayTitleSeed:
      normalizeDisplayValue(updates.displayTitleSeed) ?? normalizeDisplayValue(existing.displayTitleSeed) ?? null,
    displayAuthorSeed:
      normalizeDisplayValue(updates.displayAuthorSeed) ?? normalizeDisplayValue(existing.displayAuthorSeed) ?? null,
    canonicalTitle: normalizeDisplayValue(updates.canonicalTitle) ?? normalizeDisplayValue(existing.canonicalTitle),
    canonicalAuthor: normalizeDisplayValue(updates.canonicalAuthor) ?? normalizeDisplayValue(existing.canonicalAuthor),
    released: normalizeDisplayValue(updates.released) ?? normalizeDisplayValue(existing.released),
    durationsSeconds,
    durationSeconds: updates.durationSeconds ?? durationsSeconds?.[0] ?? existing.durationSeconds ?? null,
    subsongCount: updates.subsongCount ?? durationsSeconds?.length ?? existing.subsongCount ?? null,
    metadataUpdatedAt: updates.metadataUpdatedAt ?? new Date().toISOString(),
  };
  next.searchTextSeed = buildSeedSearchText(next);
  next.searchTextFull = buildFullSearchText(next);
  snapshot.songs[normalizedPath] = next;
  return next;
};

export const createHvscBrowseIndexMutable = async (mode: "baseline" | "update") => {
  const snapshot =
    mode === "baseline"
      ? createEmptyHvscBrowseIndexSnapshot()
      : ((await loadHvscBrowseIndexSnapshot()) ?? createEmptyHvscBrowseIndexSnapshot());

  return {
    upsertSong: (song: HvscBrowseIndexedSong) => {
      const normalizedPath = normalizePath(song.virtualPath);
      snapshot.songs[normalizedPath] = {
        virtualPath: normalizedPath,
        fileName: song.fileName || getFileName(normalizedPath),
        durationSeconds: song.durationSeconds ?? null,
        sidMetadata: song.sidMetadata ?? null,
        trackSubsongs: song.trackSubsongs ?? null,
      };
    },
    deleteSong: (virtualPath: string) => {
      delete snapshot.songs[normalizePath(virtualPath)];
    },
    finalize: async () => {
      snapshot.updatedAt = new Date().toISOString();
      snapshot.folders = buildFoldersFromSongs(snapshot.songs);
      await saveHvscBrowseIndexSnapshot(snapshot);
    },
  };
};

export const listFolderFromBrowseIndex = (
  snapshot: HvscBrowseIndexSnapshot,
  folderPath: string,
  query: string,
  offset: number,
  limit: number,
) => {
  const normalizedPath = normalizeFolderPath(folderPath);
  const normalizedQuery = query.trim().toLowerCase();
  const row = snapshot.folders[normalizedPath] ?? {
    path: normalizedPath,
    folders: [],
    songs: [],
  };

  const folders = row.folders
    .filter((folder) => normalizedQuery.length === 0 || folder.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.localeCompare(b));

  const matchedSongs = row.songs
    .map((path) => snapshot.songs[path])
    .filter((song): song is HvscBrowseIndexedSong => Boolean(song))
    .filter((song) => {
      if (normalizedQuery.length === 0) return true;
      return (
        (song.searchTextFull ?? "").includes(normalizedQuery) ||
        (song.searchTextSeed ?? "").includes(normalizedQuery) ||
        (song.sidMetadata?.name ?? "").toLowerCase().includes(normalizedQuery) ||
        (song.sidMetadata?.author ?? "").toLowerCase().includes(normalizedQuery) ||
        (song.sidMetadata?.released ?? "").toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  return {
    path: normalizedPath,
    folders,
    songs: matchedSongs.slice(offset, offset + limit).map((song) => ({
      id: hashPath(song.virtualPath),
      virtualPath: song.virtualPath,
      fileName: song.fileName,
      displayTitleSeed: song.displayTitleSeed ?? null,
      displayAuthorSeed: song.displayAuthorSeed ?? null,
      canonicalTitle: song.canonicalTitle ?? null,
      canonicalAuthor: song.canonicalAuthor ?? null,
      released: song.released ?? null,
      metadataStatus: song.metadataStatus ?? null,
      durationSeconds: song.durationSeconds ?? null,
      durationsSeconds: song.durationsSeconds ?? null,
      subsongCount: song.subsongCount ?? null,
      defaultSong: song.defaultSong ?? null,
      sidMetadata: song.sidMetadata ?? null,
      trackSubsongs: song.trackSubsongs ?? null,
    })),
    totalFolders: folders.length,
    totalSongs: matchedSongs.length,
    offset,
    limit,
    query: normalizedQuery,
  };
};

/**
 * Synchronous recursive listing of all songs under a folder path.
 * Traverses the in-memory browse index without any I/O, async overhead,
 * or smoke-benchmark recording — designed for bulk playlist operations.
 *
 * Returns null when the root folder is not present in the snapshot,
 * signaling an incomplete or stale index (callers should fall back
 * to the paged BFS path).
 */
export const listSongsRecursiveFromBrowseIndex = (
  snapshot: HvscBrowseIndexSnapshot,
  folderPath: string,
): HvscBrowseIndexedSong[] | null => {
  const normalizedRoot = normalizeFolderPath(folderPath);
  if (!snapshot.folders[normalizedRoot]) return null;
  const queue = [normalizedRoot];
  const visited = new Set<string>();
  const songs: HvscBrowseIndexedSong[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const row = snapshot.folders[current];
    if (!row) continue;
    for (const childFolder of row.folders) {
      queue.push(childFolder);
    }
    for (const songPath of row.songs) {
      const song = snapshot.songs[songPath];
      if (song) songs.push(song);
    }
  }

  return songs;
};

export const streamSongsRecursiveFromBrowseIndex = async (
  snapshot: HvscBrowseIndexSnapshot,
  folderPath: string,
  options: {
    chunkSize?: number;
    onChunk: (songs: HvscBrowseIndexedSong[]) => Promise<void> | void;
  },
): Promise<{ totalSongs: number } | null> => {
  const normalizedRoot = normalizeFolderPath(folderPath);
  if (!snapshot.folders[normalizedRoot]) return null;

  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? 250));
  const queue = [normalizedRoot];
  const visited = new Set<string>();
  let pendingChunk: HvscBrowseIndexedSong[] = [];
  let totalSongs = 0;

  const flush = async () => {
    if (!pendingChunk.length) return;
    const nextChunk = pendingChunk;
    pendingChunk = [];
    await options.onChunk(nextChunk);
  };

  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const row = snapshot.folders[current];
    if (!row) continue;

    for (const childFolder of row.folders) {
      queue.push(childFolder);
    }

    for (const songPath of row.songs) {
      const song = snapshot.songs[songPath];
      if (!song) continue;
      pendingChunk.push(song);
      totalSongs += 1;
      if (pendingChunk.length >= chunkSize) {
        await flush();
      }
    }
  }

  await flush();
  return { totalSongs };
};

export const verifyHvscBrowseIndexIntegrity = async (snapshot: HvscBrowseIndexSnapshot, sampleSize = 12) => {
  const paths = Object.keys(snapshot.songs);
  if (!paths.length) {
    return {
      isValid: true,
      sampled: 0,
      missingPaths: [] as string[],
    };
  }
  const sampled = Math.min(sampleSize, paths.length);
  // Deterministic seed derived from snapshot identity so the same dataset always
  // samples the same paths, making integrity decisions reproducible across runs.
  const offsetSeed = Math.abs(hashPath(snapshot.updatedAt)) % paths.length;
  const missingPaths: string[] = [];
  for (let index = 0; index < sampled; index += 1) {
    const path = paths[(offsetSeed + index) % paths.length];
    const filePath = resolveLibraryPath(path);
    try {
      await Filesystem.stat({ directory: Directory.Data, path: filePath });
    } catch {
      missingPaths.push(path);
    }
  }

  if (missingPaths.length > 0) {
    addLog("warn", "HVSC browse index integrity check failed", {
      sampled,
      missingCount: missingPaths.length,
      missingPaths: missingPaths.slice(0, 10),
    });
  }

  return {
    isValid: missingPaths.length === 0,
    sampled,
    missingPaths,
  };
};

export const getHvscSongFromBrowseIndex = (snapshot: HvscBrowseIndexSnapshot, virtualPath: string) => {
  return snapshot.songs[normalizePath(virtualPath)] ?? null;
};

export const getHvscFoldersWithParent = (snapshot: HvscBrowseIndexSnapshot, parentPath: string) => {
  const normalizedParent = normalizeFolderPath(parentPath);
  const row = snapshot.folders[normalizedParent];
  if (!row) return [] as Array<{ folderPath: string; folderName: string }>;
  return row.folders.map((folderPath) => ({
    folderPath,
    folderName: folderPath.split("/").pop() ?? folderPath,
  }));
};

export const listHvscFolderTracks = (snapshot: HvscBrowseIndexSnapshot, folderPath: string) => {
  const normalizedPath = normalizeFolderPath(folderPath);
  const row = snapshot.folders[normalizedPath];
  if (!row) return [] as Array<{ trackId: string; fileName: string }>;
  return row.songs.map((virtualPath) => ({
    trackId: virtualPath,
    fileName: getFileName(virtualPath),
  }));
};
