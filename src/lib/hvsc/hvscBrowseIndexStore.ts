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

// Treat file-not-found errors as expected absence (first launch, after a wipe)
// so they don't generate cold-boot warning noise; only real I/O errors log.
const isFileNotFoundError = (error: unknown) => {
  const message = ((error as { message?: unknown })?.message ?? "").toString();
  return /not found|ENOENT|does not exist|no such file|File does not exist/i.test(message);
};

const isDirectoryExistsError = (error: unknown) => {
  const message = ((error as { message?: unknown })?.message ?? "").toString();
  return /Directory exists|EEXIST|already exists/i.test(message);
};

const describeError = (error: unknown, extras: Record<string, unknown> = {}) => ({
  ...extras,
  error: (error as Error)?.message ?? String(error),
  errorName: (error as Error)?.name,
});

const STORAGE_PATH = "hvsc/index/hvsc-browse-index-v1.json";
const STORAGE_KEY = "c64u_hvsc_browse_index:v1";
const MEDIA_INDEX_STORAGE_PATH = "hvsc/index/media-index-v2.json";
const MEDIA_INDEX_STORAGE_KEY = "c64u_media_index:v1";
const SCHEMA_VERSION = 2;
const MAX_PERSISTED_FULL_SNAPSHOT_SONGS = 10000;

/**
 * The compact form the browse index is persisted as once the library is too big for the full one.
 *
 * A real HVSC is around sixty thousand songs, well past
 * {@link MAX_PERSISTED_FULL_SNAPSHOT_SONGS}, so on a real install this — not the full snapshot — is
 * what survives a restart. It therefore has to carry everything that would otherwise have to be
 * recomputed by reading sixty thousand files again.
 *
 * `title`, `author`, `released` and `hydrated` are exactly that. Without them, every launch threw
 * away the results of metadata hydration and started it over: the search could only find composers
 * by the name spelled in their folder path until hydration caught up again, and the phone re-read
 * the entire archive on every cold start. They are written only for songs that have actually been
 * hydrated, so the file grows with the work done rather than all at once.
 */
type PersistedMediaIndexEntry = {
  path: string;
  name: string;
  type: "sid";
  durationSeconds?: number | null;
  /** Canonical title from the SID header, once hydrated. */
  title?: string | null;
  /** Canonical author from the SID header, once hydrated. */
  author?: string | null;
  released?: string | null;
  /** True once this song has been read, so hydration does not queue it again. */
  hydrated?: boolean;
};

type PersistedMediaIndexSnapshot = {
  version: number;
  updatedAt: string;
  entries: PersistedMediaIndexEntry[];
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

/**
 * Strip accents, so a phone keyboard can find "Öörni" by typing "oorni".
 *
 * HVSC is full of Scandinavian and German composer names, and every accented character on Android
 * is behind a long-press. Measured on the device before this existed: "öörni" found 55 tunes and
 * "oorni" found none; "Böhme" found one and "bohme" found none. Both the text and the query are
 * folded, so typing the accent still works too.
 *
 * The ASCII test first is what keeps this cheap: almost all of the archive is plain ASCII, and
 * `normalize` on a string that needs nothing still allocates. It asks whether anything above ASCII
 * is present rather than testing a printable range — a haystack that merely contains a newline (the
 * walked-source matcher builds one) is still pure ASCII and needs no work.
 */
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const HAS_NON_ASCII = /[\u0080-\uFFFF]/;

export const foldForSearch = (value: string): string =>
  HAS_NON_ASCII.test(value) ? value.normalize("NFD").replace(COMBINING_MARKS, "") : value;

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
  } catch (error) {
    addLog("warn", "Failed to decode HVSC snapshot base64 payload", describeError(error));
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
  } catch (error) {
    addLog(
      "warn",
      "Failed to parse persisted HVSC browse snapshot; will fall back to compact media index or rebuild",
      describeError(error, { storagePath: STORAGE_PATH }),
    );
    return null;
  }
};

const parseMediaIndexSnapshot = (raw: string | null) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedMediaIndexSnapshot;
    if (!Array.isArray(parsed.entries)) return null;
    const sidEntries = parsed.entries.filter((entry) => entry.type === "sid");
    const snapshot = buildHvscBrowseIndexFromEntries(
      sidEntries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        type: "sid" as const,
        durationSeconds: entry.durationSeconds ?? null,
      })),
    );
    // Put the hydrated metadata back. Only for entries that carry it, which is nothing at all on a
    // file written before this existed and grows as hydration progresses — so the common case costs
    // one property read per song and no work.
    for (const entry of sidEntries) {
      if (!entry.hydrated && !entry.title && !entry.author && !entry.released) continue;
      const song = snapshot.songs[normalizePath(entry.path)];
      if (!song) continue;
      song.canonicalTitle = normalizeDisplayValue(entry.title);
      song.canonicalAuthor = normalizeDisplayValue(entry.author);
      song.released = normalizeDisplayValue(entry.released);
      if (entry.hydrated) song.metadataStatus = "hydrated";
      song.searchTextSeed = buildSeedSearchText(song);
      song.searchTextFull = buildFullSearchText(song);
    }
    return snapshot;
  } catch (error) {
    addLog(
      "warn",
      "Failed to parse persisted HVSC media index snapshot; will rebuild",
      describeError(error, { storagePath: MEDIA_INDEX_STORAGE_PATH }),
    );
    return null;
  }
};

const buildPersistedMediaIndexSnapshot = (snapshot: HvscBrowseIndexSnapshot): PersistedMediaIndexSnapshot => ({
  // Bumped for the hydrated fields below. A version 1 file still loads: every added field is
  // optional and its absence means exactly what it meant before — not hydrated yet.
  version: 2,
  updatedAt: snapshot.updatedAt,
  entries: Object.values(snapshot.songs).map((song) => {
    const entry: PersistedMediaIndexEntry = {
      path: song.virtualPath,
      name: song.fileName,
      type: "sid" as const,
      durationSeconds: song.durationSeconds ?? null,
    };
    // Written only when there is something to write, so an archive that has not been hydrated
    // persists exactly the same bytes it did before.
    if (song.canonicalTitle) entry.title = song.canonicalTitle;
    if (song.canonicalAuthor) entry.author = song.canonicalAuthor;
    if (song.released) entry.released = song.released;
    if (song.metadataStatus === "hydrated") entry.hydrated = true;
    return entry;
  }),
});

const shouldPersistFullSnapshot = (snapshot: HvscBrowseIndexSnapshot) =>
  Object.keys(snapshot.songs).length <= MAX_PERSISTED_FULL_SNAPSHOT_SONGS;

/**
 * Test seams for the compact round trip.
 *
 * This is the path a real library actually takes across a restart, and the only way to assert what
 * survives it is to write and read it. Exported rather than reached through the filesystem so the
 * assertion is about the encoding, not about Capacitor.
 */
export const __buildPersistedMediaIndexSnapshotForTest = buildPersistedMediaIndexSnapshot;
export const __parseMediaIndexSnapshotForTest = parseMediaIndexSnapshot;

/**
 * Whether the last save already reported the downgrade, per persistence route.
 *
 * Which snapshot a library gets is a *state*, not an event: it follows from the song count and
 * changes almost never. Metadata hydration saves every five seconds for as long as it runs, so
 * logging it on each save said the same sentence over and over — on a real 61k-song HVSC it took
 * 313 of the diagnostics log's 500 entries and pushed out everything worth reading. Announce the
 * transition instead, and again if a library ever comes back under the limit.
 */
const downgradeReported = { filesystem: false, localStorage: false };

const readFilesystemSnapshot = async () => {
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      path: STORAGE_PATH,
    });
    return parseSnapshot(typeof result.data === "string" ? decodeUtf8Base64(result.data) : null);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      addLog(
        "warn",
        "Failed to read HVSC browse snapshot from filesystem",
        describeError(error, { storagePath: STORAGE_PATH }),
      );
    }
    return null;
  }
};

const readFilesystemMediaIndexSnapshot = async () => {
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      path: MEDIA_INDEX_STORAGE_PATH,
    });
    return parseMediaIndexSnapshot(typeof result.data === "string" ? decodeUtf8Base64(result.data) : null);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      addLog(
        "warn",
        "Failed to read HVSC media index snapshot from filesystem",
        describeError(error, { storagePath: MEDIA_INDEX_STORAGE_PATH }),
      );
    }
    return null;
  }
};

const deleteFilesystemFullSnapshot = async () => {
  try {
    await Filesystem.deleteFile({
      directory: Directory.Data,
      path: STORAGE_PATH,
    });
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      addLog("warn", "Failed to delete stale HVSC full snapshot", describeError(error, { storagePath: STORAGE_PATH }));
    }
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
  await ensureFilesystemIndexDirectory();
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: STORAGE_PATH,
    data: encodeUtf8Base64(JSON.stringify(snapshot)),
  });
};

const writeFilesystemMediaIndexSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  const mediaIndexSnapshot = buildPersistedMediaIndexSnapshot(snapshot);
  await ensureFilesystemIndexDirectory();
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: MEDIA_INDEX_STORAGE_PATH,
    data: encodeUtf8Base64(JSON.stringify(mediaIndexSnapshot)),
  });
};

const ensureFilesystemIndexDirectory = async () => {
  try {
    await Filesystem.mkdir({
      directory: Directory.Data,
      path: "hvsc/index",
      recursive: true,
    });
  } catch (error) {
    if (isDirectoryExistsError(error)) return;
    throw error;
  }
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

export const saveHvscBrowseIndexSnapshot = async (
  snapshot: HvscBrowseIndexSnapshot,
  options: { foldersUnchanged?: boolean } = {},
) => {
  // Rebuilding the folder tree is O(song count) and metadata hydration calls
  // this after every small chunk - for a real ~60k-song HVSC library that is
  // an O(songs^2) rebuild that starves the JS main thread for minutes (the
  // observed cause of Remote Input's "Reconnecting" and other UI hangs during
  // a library scan). Hydration only ever edits metadata on existing entries,
  // never adds/removes/moves a song, so its virtualPaths - and therefore the
  // derived folder tree - never change; callers on that path may skip the
  // rebuild and reuse the snapshot's existing folders.
  const reuseFolders = options.foldersUnchanged && snapshot.folders && Object.keys(snapshot.folders).length > 0;
  const normalized: HvscBrowseIndexSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    songs: snapshot.songs,
    folders: reuseFolders ? snapshot.folders : buildFoldersFromSongs(snapshot.songs),
  };
  const persistFullSnapshot = shouldPersistFullSnapshot(normalized);
  if (typeof window !== "undefined") {
    try {
      await writeFilesystemMediaIndexSnapshot(normalized);
      if (persistFullSnapshot) {
        await writeFilesystemSnapshot(normalized);
        downgradeReported.filesystem = false;
      } else {
        await deleteFilesystemFullSnapshot();
        if (!downgradeReported.filesystem) {
          downgradeReported.filesystem = true;
          addLog("info", "HVSC browse snapshot persistence downgraded to compact media index", {
            path: STORAGE_PATH,
            songCount: Object.keys(normalized.songs).length,
            maxFullSnapshotSongs: MAX_PERSISTED_FULL_SNAPSHOT_SONGS,
          });
        }
      }
      return;
    } catch (error) {
      addLog(
        "warn",
        "HVSC browse snapshot filesystem persistence failed; falling back to localStorage",
        describeError(error, {
          storagePath: STORAGE_PATH,
          mediaIndexPath: MEDIA_INDEX_STORAGE_PATH,
          songCount: Object.keys(normalized.songs).length,
        }),
      );
      writeLocalStorageMediaIndexSnapshot(normalized);
      if (persistFullSnapshot) {
        writeLocalStorageSnapshot(normalized);
        downgradeReported.localStorage = false;
      } else if (typeof localStorage !== "undefined") {
        deleteLocalStorageFullSnapshot();
        if (!downgradeReported.localStorage) {
          downgradeReported.localStorage = true;
          addLog("info", "HVSC browse snapshot localStorage persistence downgraded to compact media index", {
            storageKey: STORAGE_KEY,
            songCount: Object.keys(normalized.songs).length,
            maxFullSnapshotSongs: MAX_PERSISTED_FULL_SNAPSHOT_SONGS,
          });
        }
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

/**
 * Merges songlengths durations into an existing browse index snapshot in place,
 * instead of replacing it with a fresh duration-only projection built purely from
 * buildHvscBrowseIndexFromSonglengthSnapshot. A song already present in
 * [baseSnapshot] (e.g. one that was just ingested, carrying sidMetadata and
 * trackSubsongs parsed straight from its file) only has its duration fields
 * updated; a song with no existing entry (e.g. songlengths ran before any
 * ingestion has ever populated the index) is added as a seeded record, matching
 * the previous behavior for that case. See HARD9-046.
 */
export const mergeSonglengthDurationsIntoBrowseIndex = (
  baseSnapshot: HvscBrowseIndexSnapshot | null,
  songlengthSnapshot: InMemorySongLengthSnapshot,
): HvscBrowseIndexSnapshot => {
  const snapshot = baseSnapshot ?? createEmptyHvscBrowseIndexSnapshot();
  songlengthSnapshot.pathToSeconds.forEach((durationsSeconds, virtualPath) => {
    const normalizedPath = normalizePath(virtualPath);
    if (snapshot.songs[normalizedPath]) {
      updateHvscBrowseSong(snapshot, normalizedPath, { durationsSeconds });
    } else {
      snapshot.songs[normalizedPath] = createSeededSong(normalizedPath, durationsSeconds);
    }
  });
  snapshot.updatedAt = new Date().toISOString();
  snapshot.folders = buildFoldersFromSongs(snapshot.songs);
  return snapshot;
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
      // Merge onto any existing record (e.g. from a prior ingest + songlengths
      // sync in "update" mode) instead of replacing it outright - extraction
      // only ever knows fileName/sidMetadata/trackSubsongs, so blindly
      // overwriting wiped previously hydrated canonicalTitle/canonicalAuthor/
      // released/duration fields on every re-ingest. See HARD9-046.
      const existing = snapshot.songs[normalizedPath];
      snapshot.songs[normalizedPath] = {
        ...existing,
        virtualPath: normalizedPath,
        fileName: song.fileName || existing?.fileName || getFileName(normalizedPath),
        durationSeconds: song.durationSeconds ?? existing?.durationSeconds ?? null,
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

/**
 * Everything one song can be found by, lowercased and stripped of accents.
 *
 * One function so that narrowing a folder and searching the whole archive can never disagree about
 * what a query matches. They did: the folder filter fell back to the raw SID header fields when a
 * song had no precomputed search text, and the archive search did not — so a song carrying nothing
 * but its header was findable in its own folder and invisible everywhere else.
 *
 * Cached on the song, and deliberately as a non-enumerable property: the snapshot is persisted with
 * `JSON.stringify`, which skips those, so sixty thousand cached strings never reach the file. The
 * cache is dropped automatically wherever a song is rebuilt — `updateHvscBrowseSong` spreads into a
 * fresh object — which is exactly when the text changes.
 */
const FOLDED_SEARCH_TEXT = "__foldedSearchText";

const songSearchText = (song: HvscBrowseIndexedSong): string => {
  const cached = (song as unknown as Record<string, unknown>)[FOLDED_SEARCH_TEXT];
  if (typeof cached === "string") return cached;
  const base = song.searchTextFull ?? song.searchTextSeed ?? "";
  // The raw SID header, for a song that has been ingested but not hydrated. Appended rather than
  // used as an alternative, because a hydrated song can still carry a header name that differs from
  // its canonical title, and both are things a person might type.
  const header = [song.sidMetadata?.name, song.sidMetadata?.author, song.sidMetadata?.released]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const combined = header ? `${base} ${header}`.toLowerCase() : base.toLowerCase();
  const folded = foldForSearch(combined);
  Object.defineProperty(song, FOLDED_SEARCH_TEXT, {
    value: folded,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return folded;
};

/** Tokens a query must all match, folded the same way the text is. */
export const searchQueryTokens = (query: string): string[] =>
  foldForSearch(query.trim().toLowerCase()).split(/\s+/).filter(Boolean);

const matchesTokens = (text: string, tokens: string[]): boolean => {
  for (const token of tokens) if (!text.includes(token)) return false;
  return true;
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
  // Tokenised and accent-folded, exactly as the whole-archive search is. Typing the same words and
  // switching the scope must not change what counts as a match.
  const tokens = searchQueryTokens(query);
  const row = snapshot.folders[normalizedPath] ?? {
    path: normalizedPath,
    folders: [],
    songs: [],
  };

  const folders = row.folders
    .filter((folder) => tokens.length === 0 || matchesTokens(foldForSearch(folder.toLowerCase()), tokens))
    .sort((a, b) => a.localeCompare(b));

  const matchedSongs = row.songs
    .map((path) => snapshot.songs[path])
    .filter((song): song is HvscBrowseIndexedSong => Boolean(song))
    .filter((song) => tokens.length === 0 || matchesTokens(songSearchText(song), tokens))
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
 * Search every song in the archive, not only the folder on screen.
 *
 * `listFolderFromBrowseIndex` filters one folder row, which is the right behaviour for narrowing a
 * long folder and the wrong behaviour for finding a tune. HVSC is roughly sixty thousand files
 * arranged by composer, so "find Commando" only works if you already know it is filed under
 * MUSICIANS/H/Hubbard_Rob — which is exactly the thing a search is for.
 *
 * The scan is a linear pass over the song table. That sounds expensive and is not: each song's
 * searchable text — its path, file name, title, author, release and raw SID header — is built once
 * and cached by {@link songSearchText}, so the hot loop is one `includes` per token per song and
 * nothing is allocated for the misses. Ranking runs only over what survived, which is a few hundred
 * rows rather than sixty thousand.
 *
 * Tokens are combined with AND, so "hubbard commando" narrows rather than widens. Each token may
 * match anywhere — including inside a word, so "mando" finds Commando — which is what makes an
 * author-plus-title query work without the caller having to say which word was which. Case and
 * accents are folded on both sides.
 */
export type HvscSongSearchPage = {
  songs: HvscBrowseIndexedSong[];
  /** How many songs matched in total, before `offset`/`limit`. */
  totalSongs: number;
  offset: number;
  limit: number;
  query: string;
};

/**
 * Where a token matched, lowest first.
 *
 * A search for "commando" should put the tune called Commando above every tune whose *path* happens
 * to contain the word, and a search for "hubbard" should put that composer's tunes above a tune
 * called "Hubbard Tribute" by somebody else. Ordering by where the match landed is what does that;
 * ordering by name alone buries the obvious answer under alphabetically earlier accidents.
 */
const TITLE_PREFIX = 0;
const AUTHOR_PREFIX = 1;
const TITLE_MATCH = 2;
const AUTHOR_MATCH = 3;
/**
 * The floor, not a rejection: a song only reaches scoring once every token was found somewhere in
 * its search text, so a token that is in neither the title nor the author matched the path.
 */
const PATH_MATCH = 4;

const scoreToken = (token: string, title: string, author: string): number => {
  if (title.startsWith(token)) return TITLE_PREFIX;
  if (author.startsWith(token)) return AUTHOR_PREFIX;
  if (title.includes(token)) return TITLE_MATCH;
  if (author.includes(token)) return AUTHOR_MATCH;
  return PATH_MATCH;
};

type RankedMatch = { song: HvscBrowseIndexedSong; score: number; title: string };

/**
 * Order two results: where the match landed, then title, then path.
 *
 * Plain comparison rather than `localeCompare`, which on a sixty-thousand-row sort was the single
 * most expensive thing this function did. Both operands are already lowercased and accent-folded to
 * ASCII by the time they get here, so a collator has nothing left to decide — and the path is a
 * tie-break of last resort whose only job is to be stable.
 */
const compareRanked = (a: RankedMatch, b: RankedMatch): number => {
  if (a.score !== b.score) return a.score - b.score;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  if (a.song.virtualPath === b.song.virtualPath) return 0;
  return a.song.virtualPath < b.song.virtualPath ? -1 : 1;
};

export const searchSongsFromBrowseIndex = (
  snapshot: HvscBrowseIndexSnapshot,
  query: string,
  options: { path?: string; offset?: number; limit?: number } = {},
): HvscSongSearchPage => {
  const normalizedQuery = query.trim().toLowerCase();
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.floor(options.limit ?? 200));
  const empty: HvscSongSearchPage = { songs: [], totalSongs: 0, offset, limit, query: normalizedQuery };
  if (!normalizedQuery) return empty;

  const tokens = searchQueryTokens(query);
  if (tokens.length === 0) return empty;

  // A subtree restriction, so the same scan can answer "everywhere" and "everywhere under here".
  const scope = options.path ? normalizeFolderPath(options.path) : "/";
  const scopePrefix = scope === "/" ? "/" : `${scope}/`;

  // Only this many need to be in order. A one-letter query matches sixty thousand tunes and shows a
  // hundred; ranking all sixty thousand to throw away 99.8% of the work is the difference between a
  // search that is felt and one that is not. The total is still counted exactly — it is what tells
  // the listener to narrow the search — but ordering is bounded to the page being asked for.
  const keep = offset + limit;
  const best: RankedMatch[] = [];
  let totalSongs = 0;

  for (const song of Object.values(snapshot.songs)) {
    if (scopePrefix !== "/" && !song.virtualPath.startsWith(scopePrefix)) continue;
    if (!matchesTokens(songSearchText(song), tokens)) continue;
    totalSongs += 1;

    // Folded, because the tokens are: an accented title must still be able to score as a title.
    const title = foldForSearch(getHvscDisplayTitle(song).toLowerCase());
    const author = foldForSearch((getHvscDisplayAuthor(song) ?? "").toLowerCase());
    let score = 0;
    for (const token of tokens) score += scoreToken(token, title, author);
    const candidate: RankedMatch = { song, score, title };

    // The common case for a broad query: worse than everything already held, rejected on one
    // integer comparison.
    if (best.length >= keep && compareRanked(candidate, best[best.length - 1]!) >= 0) continue;
    let low = 0;
    let high = best.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareRanked(candidate, best[mid]!) < 0) high = mid;
      else low = mid + 1;
    }
    best.splice(low, 0, candidate);
    if (best.length > keep) best.pop();
  }

  return {
    songs: best.slice(offset).map((match) => match.song),
    totalSongs,
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
 * Returns null when the root folder is not present in the snapshot, or when
 * the snapshot has zero songs anywhere, signaling an incomplete or stale
 * index (callers should fall back to the paged BFS path). A wholly-empty
 * snapshot is never trusted as "genuinely empty library, zero songs" -
 * `buildHvscBrowseIndexFromEntries` always seeds a root folder row even for
 * zero entries, so an empty root row alone doesn't distinguish "poisoned by
 * a failed integrity rebuild before the real index loaded" from "there
 * really are no songs". A real non-empty HVSC install never has zero songs
 * in the whole snapshot, so this check is safe. See HARD9-015.
 */
export const listSongsRecursiveFromBrowseIndex = (
  snapshot: HvscBrowseIndexSnapshot,
  folderPath: string,
): HvscBrowseIndexedSong[] | null => {
  if (Object.keys(snapshot.songs).length === 0) return null;
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

// Same "wholly-empty snapshot is never trustworthy" reasoning as
// listSongsRecursiveFromBrowseIndex above - see HARD9-015.
export const streamSongsRecursiveFromBrowseIndex = async (
  snapshot: HvscBrowseIndexSnapshot,
  folderPath: string,
  options: {
    chunkSize?: number;
    onChunk: (songs: HvscBrowseIndexedSong[]) => Promise<void> | void;
  },
): Promise<{ totalSongs: number } | null> => {
  if (Object.keys(snapshot.songs).length === 0) return null;
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
