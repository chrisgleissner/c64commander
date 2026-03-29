/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from "@capacitor/filesystem";
import { addErrorLog, addLog } from "@/lib/logging";
import { ensureRamDumpFolder, writeRamDumpToFolder } from "@/lib/machine/ramDumpStorage";
import { FolderPicker } from "@/lib/native/folderPicker";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { deriveRamDumpFolderDisplayPath } from "@/lib/config/ramDumpFolderStore";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import type { ReuSnapshotFileLocation, ReuSnapshotStorageEntry } from "./reuSnapshotTypes";

const REU_DATA_DIR = "reu-snapshots";
const REU_MIME_TYPE = "application/octet-stream";

const uint8ToBase64 = (value: Uint8Array) => {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const isAndroidNative = () => getPlatform() === "android" && isNativePlatform();

const sanitizeFileName = (value: string) => {
  const trimmed = value.trim() || "reu-snapshot";
  const safe = trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withExtension = safe.toLowerCase().endsWith(".reu") ? safe : `${safe}.reu`;
  return withExtension || "reu-snapshot.reu";
};

export const persistReuSnapshotFile = async (fileName: string, bytes: Uint8Array): Promise<ReuSnapshotFileLocation> => {
  const resolvedName = sanitizeFileName(fileName);
  if (isAndroidNative()) {
    const folder = await ensureRamDumpFolder();
    await writeRamDumpToFolder(folder, resolvedName, bytes);
    return {
      kind: "android-tree",
      treeUri: folder.treeUri,
      path: `/${resolvedName}`,
      rootName: folder.rootName,
      displayPath: folder.displayPath ?? deriveRamDumpFolderDisplayPath(folder.treeUri, folder.rootName),
    };
  }
  if (!isNativePlatform()) {
    throw new Error("REU snapshots are only supported on native builds.");
  }

  await Filesystem.mkdir({ directory: Directory.Data, path: REU_DATA_DIR, recursive: true });
  const path = `${REU_DATA_DIR}/${resolvedName}`;
  await Filesystem.writeFile({ directory: Directory.Data, path, data: uint8ToBase64(bytes), recursive: true });
  return {
    kind: "native-data",
    path,
  };
};

export const readReuSnapshotBytes = async (entry: ReuSnapshotStorageEntry): Promise<Uint8Array> => {
  if (entry.storage.kind === "android-tree") {
    const result = await FolderPicker.readFileFromTree({
      treeUri: entry.storage.treeUri,
      path: entry.storage.path,
    });
    return base64ToUint8(result.data);
  }
  const result = await Filesystem.readFile({
    directory: Directory.Data,
    path: entry.storage.path,
  });
  return base64ToUint8(result.data);
};

export const deleteReuSnapshotFile = async (entry: ReuSnapshotStorageEntry) => {
  if (entry.storage.kind === "native-data") {
    try {
      await Filesystem.deleteFile({ directory: Directory.Data, path: entry.storage.path });
    } catch (error) {
      addErrorLog("Failed to delete REU snapshot file", {
        path: entry.storage.path,
        error: (error as Error).message,
      });
    }
    return;
  }
  addLog("warn", "REU snapshot file delete skipped for Android SAF tree", {
    treeUri: entry.storage.treeUri,
    path: entry.storage.path,
  });
};
