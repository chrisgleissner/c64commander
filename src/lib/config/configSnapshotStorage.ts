/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from "@capacitor/filesystem";
import { FolderPicker } from "@/lib/native/folderPicker";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import { deriveRamDumpFolderDisplayPath, type RamDumpFolderConfig } from "@/lib/config/ramDumpFolderStore";
import { ensureRamDumpFolder } from "@/lib/machine/ramDumpStorage";
import { isConfigFileName } from "./configFileReferenceSelection";
import type { ConfigSnapshotFileLocation } from "./configSnapshotTypes";

const CONFIG_DATA_DIR = "config-snapshots";
const CONFIG_MIME_TYPE = "text/plain";

const uint8ToBase64 = (value: Uint8Array) => {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const isAndroidNative = () => getPlatform() === "android" && isNativePlatform();

const sanitizeConfigFileName = (value: string) => {
  const trimmed = value.trim() || "config-snapshot";
  const safe = trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withExtension = safe.toLowerCase().endsWith(".cfg") ? safe : `${safe}.cfg`;
  return withExtension || "config-snapshot.cfg";
};

export type PickedConfigSnapshotFile = {
  name: string;
  sizeBytes: number;
  modifiedAt: string | null;
  bytes: Uint8Array;
};

export const persistConfigSnapshotFile = async (
  fileName: string,
  bytes: Uint8Array,
): Promise<ConfigSnapshotFileLocation> => {
  const resolvedName = sanitizeConfigFileName(fileName);
  if (isAndroidNative()) {
    const folder = await ensureRamDumpFolder();
    await FolderPicker.writeFileToTree({
      treeUri: folder.treeUri,
      path: `/${resolvedName}`,
      data: uint8ToBase64(bytes),
      mimeType: CONFIG_MIME_TYPE,
      overwrite: true,
    });
    return {
      kind: "android-tree",
      treeUri: folder.treeUri,
      path: `/${resolvedName}`,
      rootName: folder.rootName,
      displayPath: folder.displayPath ?? deriveRamDumpFolderDisplayPath(folder.treeUri, folder.rootName),
    };
  }

  if (!isNativePlatform()) {
    throw new Error("Config snapshots are only supported on native builds.");
  }

  await Filesystem.mkdir({ directory: Directory.Data, path: CONFIG_DATA_DIR, recursive: true });
  const path = `${CONFIG_DATA_DIR}/${resolvedName}`;
  await Filesystem.writeFile({ directory: Directory.Data, path, data: uint8ToBase64(bytes), recursive: true });
  return {
    kind: "native-data",
    path,
  };
};

export const pickConfigSnapshotFile = async (
  options: { preferredFolder?: RamDumpFolderConfig | null } = {},
): Promise<PickedConfigSnapshotFile> => {
  if (!isAndroidNative()) {
    throw new Error("Config snapshots are only supported on native builds.");
  }

  const result = await FolderPicker.pickFile({
    extensions: ["cfg"],
    mimeTypes: [CONFIG_MIME_TYPE, "application/octet-stream"],
    initialUri: options.preferredFolder?.treeUri,
  });
  if (!result?.uri || !result.permissionPersisted) {
    throw new Error("Config file access was not granted.");
  }
  if (!isConfigFileName(result.name ?? "")) {
    throw new Error("Select a .cfg file.");
  }

  const payload = await FolderPicker.readFile({ uri: result.uri });
  const bytes = base64ToUint8(payload.data);
  return {
    name: result.name ?? "config.cfg",
    sizeBytes: result.sizeBytes ?? bytes.length,
    modifiedAt: result.modifiedAt ?? null,
    bytes,
  };
};
