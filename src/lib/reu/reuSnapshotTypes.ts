/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ReuSnapshotFileLocation =
  | {
      kind: "android-tree";
      treeUri: string;
      path: string;
      rootName?: string | null;
      displayPath?: string | null;
    }
  | {
      kind: "native-data";
      path: string;
    };

export type ReuSnapshotMetadata = {
  label?: string;
  content_name?: string;
  snapshot_type: "reu";
  display_ranges: string[];
  created_at: string;
  app_version?: string;
};

export type ReuSnapshotStorageEntry = {
  id: string;
  filename: string;
  createdAt: string;
  snapshotType: "reu";
  sizeBytes: number;
  remoteFileName: string;
  storage: ReuSnapshotFileLocation;
  metadata: ReuSnapshotMetadata;
};

export type ReuRestoreMode = "load-into-reu" | "preload-on-startup";

export type ReuProgressState = {
  step:
    | "preparing"
    | "scanning-temp"
    | "saving-reu"
    | "waiting-for-file"
    | "downloading"
    | "persisting"
    | "reading-local"
    | "uploading"
    | "restoring"
    | "complete";
  title: string;
  description: string;
  progress?: number | null;
};
