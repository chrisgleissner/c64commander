/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SnapshotStorageEntry, SnapshotType } from "./snapshotTypes";

/** Visible type options including the "all" sentinel. */
export type SnapshotTypeFilter = SnapshotType | "all";

/**
 * Filters snapshots by type and optional text query.
 *
 * Text matching is case-insensitive and checked against:
 *   - metadata.label
 *   - metadata.content_name
 *   - snapshotType (e.g. "full", "basic")
 *   - metadata.created_at (e.g. "2026-03-08")
 */
export const filterSnapshots = (
  entries: SnapshotStorageEntry[],
  query: string,
  typeFilter: SnapshotTypeFilter,
): SnapshotStorageEntry[] => {
  let filtered = entries;

  if (typeFilter !== "all") {
    filtered = filtered.filter((e) => e.snapshotType === typeFilter);
  }

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return filtered;

  return filtered.filter((e) => {
    const label = (e.metadata.label ?? "").toLowerCase();
    const contentName = (e.metadata.content_name ?? "").toLowerCase();
    const typeName = e.snapshotType.toLowerCase();
    const createdAt = (e.metadata.created_at ?? "").toLowerCase();
    return (
      label.includes(trimmed) ||
      contentName.includes(trimmed) ||
      typeName.includes(trimmed) ||
      createdAt.includes(trimmed)
    );
  });
};
