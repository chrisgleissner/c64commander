/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReuSnapshotStorageEntry } from "@/lib/reu/reuSnapshotTypes";
import type { SnapshotStorageEntry, SnapshotType } from "@/lib/snapshot/snapshotTypes";

export type RestorableSnapshotEntry = SnapshotStorageEntry | ReuSnapshotStorageEntry;
export type RestorableSnapshotType = SnapshotType | "reu";

export const isReuSnapshotEntry = (snapshot: RestorableSnapshotEntry): snapshot is ReuSnapshotStorageEntry =>
  snapshot.snapshotType === "reu";
