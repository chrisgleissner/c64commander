/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ConfigSnapshotFileLocation =
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

export type SavedConfigSnapshot = {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  remoteFileName: string;
  storage: ConfigSnapshotFileLocation;
};

export type ConfigProgressState = {
  step:
    | "preparing"
    | "scanning-temp"
    | "saving-config"
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
