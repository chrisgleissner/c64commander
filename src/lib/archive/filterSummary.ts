/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ArchivePreset, ArchiveSearchParams } from "./types";

const FILTER_LABELS: ReadonlyArray<readonly [keyof ArchiveSearchParams, string]> = [
  ["name", "Name"],
  ["group", "Group"],
  ["handle", "Handle"],
  ["event", "Event"],
  ["category", "Category"],
  ["date", "Date"],
  ["type", "Type"],
  ["sort", "Sort by"],
  ["order", "Order"],
];

/**
 * Describes the filled-in archive search fields in plain words, for example "Name joyride, Category Apps".
 * Preset fields show the name the user picked, not the key the archive's query language uses.
 */
export const describeArchiveFilters = (params: ArchiveSearchParams, presets: readonly ArchivePreset[]): string => {
  const presetByType = new Map(presets.map((preset) => [preset.type, preset]));
  const parts: string[] = [];
  for (const [key, label] of FILTER_LABELS) {
    const value = params[key]?.trim();
    if (!value) continue;
    const presetName = presetByType
      .get(key as ArchivePreset["type"])
      ?.values.find((entry) => entry.aqlKey === value)?.name;
    parts.push(`${label} ${presetName ?? value}`);
  }
  return parts.join(", ");
};
