/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getDiskFolderPath, normalizeDiskPath } from './diskTypes';

const stripExtension = (name: string) => {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return name;
  return name.slice(0, idx);
};

const inferGroupBase = (name: string) => {
  const base = stripExtension(name).trim();
  if (!base) return null;
  const match = base.match(/^(.*?)(?:[\s._-]*([A-Za-z]|\d+))$/);
  if (!match) return null;
  const prefix = match[1]?.trim();
  if (!prefix || prefix.length < 2) return null;
  return prefix;
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
      const base = inferGroupBase(file.name);
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

