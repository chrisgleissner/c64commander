/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ArchiveSearchParams } from "./types";

const TEXT_FIELDS = ["name", "group", "handle", "event"] as const;
const ENUM_FIELDS = ["category", "date", "type", "sort", "order"] as const;

const hasValue = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;

const escapeQuoted = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const buildArchiveQuery = (params: ArchiveSearchParams): string => {
  const tokens: string[] = [];

  TEXT_FIELDS.forEach((field) => {
    const value = params[field];
    if (!hasValue(value)) return;
    tokens.push(`(${field}:"${escapeQuoted(value.trim())}")`);
  });

  ENUM_FIELDS.forEach((field) => {
    const value = params[field];
    if (!hasValue(value)) return;
    tokens.push(`(${field}:${value.trim()})`);
  });

  if (!tokens.length) {
    throw new Error("Enter at least one archive search term.");
  }

  return tokens.join(" & ");
};

export const buildArchiveQueryParam = (params: ArchiveSearchParams): string =>
  encodeURIComponent(buildArchiveQuery(params));
