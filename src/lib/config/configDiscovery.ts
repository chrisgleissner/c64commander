/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ConfigFileReference } from "@/lib/config/configFileReference";
import { isConfigFileName } from "@/lib/config/configFileReferenceSelection";
import { buildConfigReferenceFromSourceEntry } from "@/lib/config/configFileReferenceSelection";
import { dedupeConfigCandidates, type ConfigCandidate } from "@/lib/config/playbackConfig";
import { firmwareAssociatedConfigFor } from "@/lib/config/firmwareAssociatedConfig";
import { getPlayCategory } from "@/lib/playback/fileTypes";
import { getParentPath } from "@/lib/playback/localFileBrowser";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

type LocalEntry = {
  uri?: string | null;
  name: string;
  modifiedAt?: string | null;
  sizeBytes?: number | null;
};

export type DiscoverConfigCandidatesOptions = {
  sourceType: "local" | "ultimate";
  sourceId?: string | null;
  sourceRootPath: string;
  targetFile: Pick<SourceEntry, "name" | "path">;
  listEntries: (path: string) => Promise<SourceEntry[]>;
  prefetchedEntriesByPath?: Map<string, SourceEntry[]>;
  localEntriesBySourceId?: Map<string, Map<string, LocalEntry>>;
};

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, "");

const buildCandidate = (
  ref: ConfigFileReference,
  strategy: ConfigCandidate["strategy"],
  distance: number,
  confidence: ConfigCandidate["confidence"],
): ConfigCandidate => ({ ref, strategy, distance, confidence });

const shouldContinueAscending = (currentParent: string, rootPath: string) => {
  const normalizedCurrent = normalizeSourcePath(currentParent);
  const normalizedRoot = normalizeSourcePath(rootPath || "/");
  if (normalizedCurrent === normalizedRoot) {
    return normalizedRoot !== "/";
  }
  return normalizedCurrent.startsWith(normalizedRoot);
};

const resolveEntriesForPath = async (
  path: string,
  listEntries: (path: string) => Promise<SourceEntry[]>,
  prefetchedEntriesByPath?: Map<string, SourceEntry[]>,
) => {
  const normalizedPath = normalizeSourcePath(path);
  const prefetched = prefetchedEntriesByPath?.get(normalizedPath);
  if (prefetched) return prefetched;
  const entries = await listEntries(normalizedPath);
  prefetchedEntriesByPath?.set(normalizedPath, entries);
  return entries;
};

export const discoverConfigCandidates = async ({
  sourceType,
  sourceId,
  sourceRootPath,
  targetFile,
  listEntries,
  prefetchedEntriesByPath,
  localEntriesBySourceId,
}: DiscoverConfigCandidatesOptions) => {
  const targetPath = normalizeSourcePath(targetFile.path);
  const sameDirectoryPath = getParentPath(targetPath);
  const baseName = stripExtension(targetFile.name).toLowerCase();
  const discovered: ConfigCandidate[] = [];

  const buildRef = (entry: SourceEntry, allowFirmwareFallbackExtension = false) =>
    buildConfigReferenceFromSourceEntry({
      sourceType,
      sourceId,
      entry,
      localEntriesBySourceId,
      allowFirmwareFallbackExtension,
    });

  const sameDirectoryEntries = await resolveEntriesForPath(sameDirectoryPath, listEntries, prefetchedEntriesByPath);
  const cfgEntries = sameDirectoryEntries.filter((entry) => entry.type === "file" && isConfigFileName(entry.name));

  cfgEntries.forEach((entry) => {
    const strategy = stripExtension(entry.name).toLowerCase() === baseName ? "exact-name" : "directory";
    const confidence = strategy === "exact-name" ? "high" : "medium";
    discovered.push(buildCandidate(buildRef(entry), strategy, 0, confidence));
  });

  /*
   * The firmware falls back to `<program>.usr` when no `<program>.cfg` sits beside a PRG, and it
   * applies that file whether or not the app knows about it. Offering it as the same kind of
   * candidate is what lets the app name it, edit it and decline it; firmwareAssociatedConfigFor
   * returns the `.cfg` first, so this only ever adds the fallback the firmware would really use.
   */
  const firmwareFallbackName = firmwareAssociatedConfigFor({
    fileName: targetFile.name,
    category: getPlayCategory(targetPath),
    siblingFileNames: sameDirectoryEntries.filter((entry) => entry.type === "file").map((entry) => entry.name),
  });
  if (firmwareFallbackName && !isConfigFileName(firmwareFallbackName)) {
    const fallbackEntry = sameDirectoryEntries.find(
      (entry) => entry.type === "file" && entry.name.toLowerCase() === firmwareFallbackName.toLowerCase(),
    );
    if (fallbackEntry) {
      discovered.push(buildCandidate(buildRef(fallbackEntry, true), "exact-name", 0, "high"));
    }
  }

  let distance = 1;
  let currentPath = getParentPath(sameDirectoryPath);
  const visited = new Set<string>();
  while (currentPath && !visited.has(currentPath) && shouldContinueAscending(currentPath, sourceRootPath)) {
    visited.add(currentPath);
    const entries = await resolveEntriesForPath(currentPath, listEntries, prefetchedEntriesByPath);
    entries
      .filter((entry) => entry.type === "file" && isConfigFileName(entry.name))
      .forEach((entry) => {
        discovered.push(buildCandidate(buildRef(entry), "parent-directory", distance, "low"));
      });
    const nextPath = getParentPath(currentPath);
    if (nextPath === currentPath) break;
    currentPath = nextPath;
    distance += 1;
  }

  return dedupeConfigCandidates(discovered);
};
