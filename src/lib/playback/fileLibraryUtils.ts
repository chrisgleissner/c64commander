/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FolderPicker } from "@/lib/native/folderPicker";
import { normalizeDiskPath } from "@/lib/disks/diskTypes";
import type { PlayRequest, PlaySource, LocalPlayFile } from "./playbackRouter";
import type { FileLibraryEntry } from "./fileLibraryTypes";

export const normalizeFilePath = (path: string) => normalizeDiskPath(path);

export const buildFileLibraryId = (source: PlaySource, path: string, sourceId?: string | null) => {
  const normalized = normalizeFilePath(path);
  const sourceKey = source === "ultimate" ? "ultimate" : source === "hvsc" ? sourceId || "hvsc" : sourceId || "local";
  return `${sourceKey}:${normalized}`;
};

const base64ToArrayBuffer = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

// A native SAF read that never settles would otherwise hold the playback
// single-flight guard and block the play transition queue forever; bound it so
// a stuck read becomes a visible, recoverable failure.
const LOCAL_READ_TIMEOUT_MS = 15_000;

const readWithTimeout = async <T>(read: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Local file unavailable. Re-add it to the playlist.")),
      LOCAL_READ_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const buildLocalPlayFileFromUri = (
  name: string,
  path: string,
  uri: string,
  lastModified?: number,
): LocalPlayFile => ({
  name,
  webkitRelativePath: path,
  lastModified: lastModified ?? Date.now(),
  arrayBuffer: async () => {
    const data = await readWithTimeout(FolderPicker.readFile({ uri }));
    return base64ToArrayBuffer(data.data);
  },
});

export const buildLocalPlayFileFromTree = (
  name: string,
  path: string,
  treeUri: string,
  lastModified?: number,
): LocalPlayFile => ({
  name,
  webkitRelativePath: path,
  lastModified: lastModified ?? Date.now(),
  arrayBuffer: async () => {
    const data = await readWithTimeout(FolderPicker.readFileFromTree({ treeUri, path }));
    return base64ToArrayBuffer(data.data);
  },
});

export const resolvePlayRequestFromLibrary = (
  entry: FileLibraryEntry,
  runtimeFiles: Record<string, LocalPlayFile>,
): PlayRequest => {
  if (entry.source === "ultimate") {
    return { source: "ultimate", path: entry.path };
  }
  const runtime = runtimeFiles[entry.id];
  const file =
    runtime || (entry.localUri ? buildLocalPlayFileFromUri(entry.name, entry.path, entry.localUri) : undefined);
  if (entry.source === "hvsc") {
    return { source: "hvsc", path: entry.path, file };
  }
  return { source: "local", path: entry.path, file };
};
