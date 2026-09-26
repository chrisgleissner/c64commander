/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getDiskFolderPath, normalizeDiskPath } from "./diskTypes";

const stripExtension = (name: string) => {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return name;
  return name.slice(0, idx);
};

const SEPARATOR = "[\\s._-]";
// "_S1", " side A", "-Disk2", " (Disk 1 of 2)": a disk or side word only counts after a separator,
// so the "d" in "Hard1" or the "s" in "Katakis" stays part of the title.
const MARKED_SUFFIX = new RegExp(
  `^(.*?)${SEPARATOR}*[\\s._([-](?:side|disk|disc|part|s|d)${SEPARATOR}*(?:[A-Za-z]|\\d+)(?:${SEPARATOR}*of${SEPARATOR}*\\d+)?[)\\]]?$`,
  "i",
);
const BARE_SUFFIX = new RegExp(`^(.*?)(?:${SEPARATOR}*([A-Za-z]|\\d+))$`);
const TRAILING_SEPARATORS = /[\s._([-]+$/;

const toGroupPrefix = (match: RegExpMatchArray | null) => {
  const prefix = match?.[1]?.replace(TRAILING_SEPARATORS, "").trim();
  return prefix && prefix.length >= 2 ? prefix : null;
};

export const inferDiskGroupBase = (name: string) => {
  const base = stripExtension(name).trim();
  if (!base) return null;
  return toGroupPrefix(base.match(MARKED_SUFFIX)) ?? toGroupPrefix(base.match(BARE_SUFFIX));
};

const legacyInferDiskGroupBase = (name: string) => {
  const base = stripExtension(name).trim();
  const prefix = base.match(/^(.*?)(?:[\s._-]*([A-Za-z]|\d+))$/)?.[1]?.trim();
  return prefix && prefix.length >= 2 ? prefix : null;
};
const LEGACY_MARKER_REMNANT = new RegExp(`${SEPARATOR}+(?:side|disk|disc|part|s|d)$`, "i");

const repairedLegacyGroupName = (group: string) => {
  const repaired = group.replace(LEGACY_MARKER_REMNANT, "").replace(TRAILING_SEPARATORS, "").trim();
  return repaired.length >= 2 && repaired !== group ? repaired : null;
};

/**
 * Repair group names the earlier rule saved with the side marker's letters left on
 * ("Turrican_(Original)_S"). Only a group that looks auto-assigned is touched — two or more disks in
 * one folder, each named so the earlier rule gives exactly that group — and every member gets the same
 * new name, so a group the user chose, or one they shared across folders, is left alone.
 */
export const repairLegacyDiskGroups = <T extends { group: string | null; name: string; path: string }>(
  disks: T[],
): T[] => {
  const members = new Map<string, T[]>();
  disks.forEach((disk) => {
    if (disk.group) members.set(disk.group, [...(members.get(disk.group) ?? []), disk]);
  });
  const renames = new Map<string, string>();
  members.forEach((group, name) => {
    const folders = new Set(group.map((disk) => getDiskFolderPath(disk.path)));
    const autoAssigned =
      group.length >= 2 && folders.size === 1 && group.every((disk) => legacyInferDiskGroupBase(disk.name) === name);
    const repaired = autoAssigned ? repairedLegacyGroupName(name) : null;
    if (repaired) renames.set(name, repaired);
  });
  if (renames.size === 0) return disks;
  return disks.map((disk) =>
    disk.group && renames.has(disk.group) ? { ...disk, group: renames.get(disk.group) ?? disk.group } : disk,
  );
};

export const assignDiskGroupsByPrefix = (entries: Array<{ path: string; name: string }>) => {
  const normalized = entries.map((entry) => ({
    ...entry,
    path: normalizeDiskPath(entry.path),
    folder: getDiskFolderPath(entry.path),
  }));

  const grouped = new Map<string, Array<{ path: string; name: string }>>();
  normalized.forEach((entry) => {
    const list = grouped.get(entry.folder) ?? [];
    list.push({ path: entry.path, name: entry.name });
    grouped.set(entry.folder, list);
  });

  const result = new Map<string, string | null>();
  grouped.forEach((files) => {
    const baseCounts = new Map<string, { base: string; count: number }>();
    const fileBases = files.map((file) => {
      const base = inferDiskGroupBase(file.name);
      if (!base) return { path: file.path, base: null };
      const key = base.toLowerCase();
      const existing = baseCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        baseCounts.set(key, { base, count: 1 });
      }
      return { path: file.path, base: key };
    });

    const validBases = new Map<string, string>();
    baseCounts.forEach((value, key) => {
      if (value.count >= 2) {
        validBases.set(key, value.base);
      }
    });

    fileBases.forEach((entry) => {
      if (entry.base && validBases.has(entry.base)) {
        result.set(entry.path, validBases.get(entry.base) ?? null);
      }
    });
  });

  return result;
};
