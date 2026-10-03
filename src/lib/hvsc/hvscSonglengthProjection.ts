/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { InMemorySongLengthSnapshot } from "@/lib/songlengths";
import {
  buildFoldersFromSongs,
  createEmptyHvscBrowseIndexSnapshot,
  createSeededSong,
  normalizePath,
  updateHvscBrowseSong,
  type HvscBrowseIndexedSong,
  type HvscBrowseIndexSnapshot,
} from "./hvscBrowseIndexStore";

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
): HvscBrowseIndexSnapshot => mergeSonglengthDurations(baseSnapshot, songlengthSnapshot).snapshot;

/**
 * As {@link mergeSonglengthDurationsIntoBrowseIndex}, and whether anything changed. A song whose
 * durations it already carries is left as it is: rebuilding all sixty thousand on every start, then
 * the folder tree, then writing the 13 MB result back, took about two seconds on a Pixel 4.
 */
export const mergeSonglengthDurations = (
  baseSnapshot: HvscBrowseIndexSnapshot | null,
  songlengthSnapshot: InMemorySongLengthSnapshot,
): { snapshot: HvscBrowseIndexSnapshot; changed: boolean } => {
  const snapshot = baseSnapshot ?? createEmptyHvscBrowseIndexSnapshot();
  let changed = baseSnapshot === null;
  songlengthSnapshot.pathToSeconds.forEach((durationsSeconds, virtualPath) => {
    const normalizedPath = normalizePath(virtualPath);
    const existing = snapshot.songs[normalizedPath];
    if (existing && carriesDurations(existing, durationsSeconds)) return;
    changed = true;
    if (existing) {
      updateHvscBrowseSong(snapshot, normalizedPath, { durationsSeconds });
    } else {
      snapshot.songs[normalizedPath] = createSeededSong(normalizedPath, durationsSeconds);
    }
  });
  if (changed) {
    snapshot.updatedAt = new Date().toISOString();
    snapshot.folders = buildFoldersFromSongs(snapshot.songs);
  }
  return { snapshot, changed };
};

/** Whether a song already holds exactly what updating it with these durations would give it. */
const carriesDurations = (song: HvscBrowseIndexedSong, durationsSeconds: readonly number[]) =>
  durationsSeconds.length > 0 &&
  song.durationsSeconds?.length === durationsSeconds.length &&
  song.durationsSeconds.every((seconds, index) => seconds === durationsSeconds[index]) &&
  song.durationSeconds === durationsSeconds[0] &&
  song.subsongCount === durationsSeconds.length &&
  typeof song.searchTextSeed === "string" &&
  typeof song.searchTextFull === "string";
