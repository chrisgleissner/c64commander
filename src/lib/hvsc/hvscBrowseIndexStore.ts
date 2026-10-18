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
import { createTimeSlicer, type TimeSlicer } from "@/lib/async/timeSlice";
import {
  buildFoldersFromSongs,
  buildFoldersFromSongsSliced,
  normalizeFolderPath,
  normalizePath,
} from "@/lib/hvsc/hvscBrowseFolders";

export { buildFoldersFromSongs, normalizePath };
import { withoutUnknownPlaceholder } from "@/lib/sid/unknownPlaceholder";
import type { InMemorySongLengthSnapshot } from "@/lib/songlengths";
import type { HvscSidMetadata, HvscTrackSubsong } from "./hvscTypes";
import { readDataFileText, resolveLibraryPath, writeDataFileText } from "./hvscFilesystem";
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
  /**
   * One length per tune in the file, when it holds more than one.
   *
   * A SID is a small album, and this is the only record of how many tunes are in it: the count lives
   * in the file's header, not in the index. Without it a restart leaves every multi-tune SID looking
   * like a single track — no "Tune 3 of 19" on the card, no subsong selector, and nothing to offer
   * to play them all. Written only for files that actually hold more than one, so single-tune
   * entries, which are most of them, cost nothing.
   */
  durations?: number[];
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

const normalizeDisplayValue = (value: string | null | undefined) =>
  (value && withoutUnknownPlaceholder(value.replace(/_/g, " ").replace(/\s+/g, " ").trim())) || null;

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

export const createSeededSong = (
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

const hashPath = (value: string) =>
  Math.abs(Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0));

const getFileName = (virtualPath: string) => {
  const normalized = normalizePath(virtualPath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.substring(index + 1) : normalized;
};

const toIndexedSong = (entry: MediaEntry): HvscBrowseIndexedSong => {
  const displayTitleSeed = deriveSeedTitle(entry.name);
  const displayAuthorSeed = deriveSeedAuthor(entry.path);
  const searchText = [entry.path, entry.name, displayTitleSeed, displayAuthorSeed]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return {
    virtualPath: normalizePath(entry.path),
    fileName: entry.name,
    displayTitleSeed,
    displayAuthorSeed,
    canonicalTitle: null,
    canonicalAuthor: null,
    released: null,
    durationSeconds: entry.durationSeconds ?? null,
    durationsSeconds: entry.durationSeconds != null ? [entry.durationSeconds] : null,
    subsongCount: entry.durationSeconds != null ? 1 : null,
    defaultSong: 1,
    metadataStatus: entry.durationSeconds != null ? "seeded" : null,
    metadataUpdatedAt: null,
    searchTextSeed: searchText,
    searchTextFull: searchText,
    sidMetadata: null,
    trackSubsongs: entry.durationSeconds != null ? [{ songNr: 1, isDefault: true }] : null,
  };
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

const readPersistedSidEntries = (raw: string): PersistedMediaIndexEntry[] | null => {
  const parsed = JSON.parse(raw) as PersistedMediaIndexSnapshot;
  if (!Array.isArray(parsed.entries)) return null;
  return parsed.entries.filter((entry) => entry.type === "sid");
};

const toMediaEntry = (entry: PersistedMediaIndexEntry): MediaEntry => ({
  path: entry.path,
  name: entry.name,
  type: "sid" as const,
  durationSeconds: entry.durationSeconds ?? null,
});

/**
 * Put the hydrated metadata back. Only for entries that carry it, which is nothing at all on a file written before this
 * existed and grows as hydration progresses, so the common case costs one property read per song and no work.
 */
const restoreHydratedMetadata = (snapshot: HvscBrowseIndexSnapshot, entry: PersistedMediaIndexEntry) => {
  if (!entry.hydrated && !entry.title && !entry.author && !entry.released && !entry.durations) return;
  const song = snapshot.songs[normalizePath(entry.path)];
  if (entry.durations && entry.durations.length > 1) {
    // Restores the tune count with it, which is what the card, the subsong selector and "play
    // all tunes" all read.
    song.durationsSeconds = [...entry.durations];
    song.subsongCount = entry.durations.length;
    song.trackSubsongs = entry.durations.map((_, index) => ({ songNr: index + 1, isDefault: index === 0 }));
  }
  song.canonicalTitle = normalizeDisplayValue(entry.title);
  song.canonicalAuthor = normalizeDisplayValue(entry.author);
  song.released = normalizeDisplayValue(entry.released);
  if (entry.hydrated) song.metadataStatus = "hydrated";
  song.searchTextSeed = buildSeedSearchText(song);
  song.searchTextFull = buildFullSearchText(song);
};

const warnMediaIndexParseFailed = (error: unknown) =>
  addLog(
    "warn",
    "Failed to parse persisted HVSC media index snapshot; will rebuild",
    describeError(error, { storagePath: MEDIA_INDEX_STORAGE_PATH }),
  );

const parseMediaIndexSnapshot = (raw: string | null) => {
  if (!raw) return null;
  try {
    const sidEntries = readPersistedSidEntries(raw);
    if (!sidEntries) return null;
    const snapshot = buildHvscBrowseIndexFromEntries(sidEntries.map(toMediaEntry));
    for (const entry of sidEntries) restoreHydratedMetadata(snapshot, entry);
    return snapshot;
  } catch (error) {
    warnMediaIndexParseFailed(error);
    return null;
  }
};

/**
 * {@link parseMediaIndexSnapshot} for the 60,000-song file read at startup: the same result, built in slices so that
 * a key press or a paint is handled between them. Only the JSON text itself is parsed in one piece.
 */
const parseMediaIndexSnapshotSliced = async (raw: string | null, slice: TimeSlicer) => {
  if (!raw) return null;
  try {
    const sidEntries = readPersistedSidEntries(raw);
    if (!sidEntries) return null;
    const songs: Record<string, HvscBrowseIndexedSong> = {};
    for (const entry of sidEntries) {
      if (slice.due()) await slice.yield();
      const song = toIndexedSong(toMediaEntry(entry));
      songs[song.virtualPath] = song;
    }
    const snapshot: HvscBrowseIndexSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      songs,
      folders: await buildFoldersFromSongsSliced(songs, slice),
    };
    for (const entry of sidEntries) {
      if (slice.due()) await slice.yield();
      restoreHydratedMetadata(snapshot, entry);
    }
    return snapshot;
  } catch (error) {
    warnMediaIndexParseFailed(error);
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
    if (song.durationsSeconds && song.durationsSeconds.length > 1) entry.durations = song.durationsSeconds;
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
export const __parseMediaIndexSnapshotSlicedForTest = parseMediaIndexSnapshotSliced;

/**
 * Whether the last save already reported the downgrade, per persistence route.
 *
 * Which snapshot a library gets is a *state*, not an event: it follows from the song count and
 * changes almost never. Metadata hydration saves periodically for as long as it runs, so
 * logging it on each save said the same sentence over and over — on a real 61k-song HVSC it took
 * 313 of the diagnostics log's 500 entries and pushed out everything worth reading. Announce the
 * transition instead, and again if a library ever comes back under the limit.
 */
const downgradeReported = { filesystem: false, localStorage: false };

/**
 * Both snapshots are read through {@link readDataFileText} rather than `Filesystem.readFile`.
 *
 * A real HVSC persists 13.2 MB here, and the bridge hands a file back as one base64 string in one
 * message — 1,084 ms and a 17.6 MB intermediate string on a Pixel 4, against 258 ms through the
 * WebView's file server. "Find a tune" cannot answer until this snapshot is resident, so this read
 * is directly in front of the listener.
 */
const readFilesystemSnapshot = async () => {
  try {
    return parseSnapshot(await readDataFileText(STORAGE_PATH));
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
    const readAt = performance.now();
    const text = await readDataFileText(MEDIA_INDEX_STORAGE_PATH);
    const parseAt = performance.now();
    addLog("info", "HVSC media index snapshot bytes read", {
      storagePath: MEDIA_INDEX_STORAGE_PATH,
      bytes: text?.length ?? 0,
      readMs: Math.round(parseAt - readAt),
    });
    const snapshot = await parseMediaIndexSnapshotSliced(text, createTimeSlicer());
    // The two halves are paid on completely different budgets — one is I/O, the other is main-thread
    // CPU over sixty thousand songs — so a single figure cannot say which one to go and reduce.
    addLog("info", "HVSC media index snapshot read", {
      storagePath: MEDIA_INDEX_STORAGE_PATH,
      bytes: text?.length ?? 0,
      readMs: Math.round(parseAt - readAt),
      buildMs: Math.round(performance.now() - parseAt),
      songs: snapshot ? Object.keys(snapshot.songs).length : 0,
    });
    return snapshot;
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
  forgetHvscBrowseIndexSnapshot();
  if (typeof window !== "undefined") {
    try {
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: STORAGE_PATH,
      });
    } catch (error) {
      // Clearing a snapshot that was never written, as a reset before the first index does, is not a failure.
      if (!isFileNotFoundError(error)) {
        addLog("warn", "Failed to delete HVSC browse snapshot", {
          path: STORAGE_PATH,
          error: (error as Error).message,
        });
      }
    }
    try {
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: MEDIA_INDEX_STORAGE_PATH,
      });
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        addLog("warn", "Failed to delete HVSC media snapshot", {
          path: MEDIA_INDEX_STORAGE_PATH,
          error: (error as Error).message,
        });
      }
    }
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(MEDIA_INDEX_STORAGE_KEY);
  }
};

const writeFilesystemSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  await ensureFilesystemIndexDirectory();
  await writeDataFileText(STORAGE_PATH, JSON.stringify(snapshot));
};

const writeFilesystemMediaIndexSnapshot = async (snapshot: HvscBrowseIndexSnapshot) => {
  await ensureFilesystemIndexDirectory();
  await writeDataFileText(MEDIA_INDEX_STORAGE_PATH, JSON.stringify(buildPersistedMediaIndexSnapshot(snapshot)));
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

const readStoredBrowseIndexSnapshot = async () => {
  if (typeof window !== "undefined") {
    const filesystemSnapshot = await readFilesystemSnapshot();
    if (filesystemSnapshot) return filesystemSnapshot;
    const filesystemMediaIndexSnapshot = await readFilesystemMediaIndexSnapshot();
    if (filesystemMediaIndexSnapshot) return filesystemMediaIndexSnapshot;
  }
  return readLocalStorageSnapshot() ?? readLocalStorageMediaIndexSnapshot();
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

/*
 * The snapshot last read from storage, until the next write or clear. Startup read and parsed the
 * 13 MB media index twice, once for the media index and once for the Songlengths projection: about
 * 1.3 s of main-thread parsing each on a Pixel 4. Callers get their own songs and folders maps, so one
 * caller's replacements, such as an ingestion canceled half way, never show in what another loads; the
 * song objects are shared, and nothing outside parsing changes one in place.
 */
let lastStoredSnapshot: HvscBrowseIndexSnapshot | null = null;
let snapshotEpoch = 0;

const copySnapshot = (snapshot: HvscBrowseIndexSnapshot): HvscBrowseIndexSnapshot => ({
  ...snapshot,
  songs: { ...snapshot.songs },
  folders: { ...snapshot.folders },
});

const rememberSnapshot = (snapshot: HvscBrowseIndexSnapshot | null) => {
  snapshotEpoch += 1;
  lastStoredSnapshot = snapshot ? copySnapshot(snapshot) : null;
};

/** Drops the remembered snapshot, so the next load reads storage again. */
export const forgetHvscBrowseIndexSnapshot = () => rememberSnapshot(null);

/**
 * The remembered snapshot itself, with no copy of its maps, for a caller that only reads it. Copying the song and
 * folder maps of a full HVSC library took about 260 ms on the keypad phone, and the media index loads this on the
 * first visit to Play or Disks. A caller that changes songs or folders must use {@link loadHvscBrowseIndexSnapshot}.
 */
export const loadHvscBrowseIndexSnapshotReadOnly = async (): Promise<HvscBrowseIndexSnapshot | null> => {
  if (lastStoredSnapshot) return lastStoredSnapshot;
  const loaded = await loadHvscBrowseIndexSnapshot();
  return lastStoredSnapshot ?? loaded;
};

export const loadHvscBrowseIndexSnapshot = async () => {
  if (lastStoredSnapshot) return copySnapshot(lastStoredSnapshot);
  return runWithHvscPerfScope(
    "browse:load-snapshot",
    async () => {
      const epochAtStart = snapshotEpoch;
      const loaded = await readStoredBrowseIndexSnapshot();
      if (epochAtStart === snapshotEpoch) rememberSnapshot(loaded);
      return loaded;
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
  // Forgotten, not remembered: what is read back is normalized (a seeded song's metadataStatus, for
  // one), so only a snapshot read from storage stands in for reading it again.
  forgetHvscBrowseIndexSnapshot();
  await persistHvscBrowseIndexSnapshot(normalized);
};

const persistHvscBrowseIndexSnapshot = async (normalized: HvscBrowseIndexSnapshot) => {
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

const songRevisions = new WeakMap<HvscBrowseIndexSnapshot, number>();

/** Call after changing `snapshot.songs` in place, so a search does not narrow from matches it held before. */
export const noteHvscBrowseSongsChanged = (snapshot: HvscBrowseIndexSnapshot) => {
  songRevisions.set(snapshot, (songRevisions.get(snapshot) ?? 0) + 1);
};

/** Changes each time {@link noteHvscBrowseSongsChanged} is called for `snapshot`. */
export const hvscBrowseSongsRevision = (snapshot: HvscBrowseIndexSnapshot) => songRevisions.get(snapshot) ?? 0;

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
  noteHvscBrowseSongsChanged(snapshot);
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
      noteHvscBrowseSongsChanged(snapshot);
    },
    deleteSong: (virtualPath: string) => {
      delete snapshot.songs[normalizePath(virtualPath)];
      noteHvscBrowseSongsChanged(snapshot);
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

export const songSearchText = (song: HvscBrowseIndexedSong): string => {
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

export const matchesTokens = (text: string, tokens: string[]): boolean => {
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
    } catch (error) {
      // Not silent: a stat failure is the signal this loop looks for, and every miss is reported
      // together in the integrity warning below.
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
