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
