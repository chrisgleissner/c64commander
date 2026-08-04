/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from "@capacitor/filesystem";
import { addLog } from "@/lib/logging";
import { readDataFileText } from "@/lib/hvsc/hvscFilesystem";
import type { MediaIndexSnapshot, MediaIndexStorage } from "./mediaIndex";

const STORAGE_PATH = "hvsc/index/media-index-v2.json";

const isFileNotFoundError = (error: unknown) => {
  const message = ((error as { message?: unknown })?.message ?? "").toString();
  return /not found|ENOENT|does not exist|no such file|File does not exist/i.test(message);
};

const isDirectoryExistsError = (error: unknown) => {
  const message = ((error as { message?: unknown })?.message ?? "").toString();
  return /Directory exists|EEXIST|already exists/i.test(message);
};

const describeError = (error: unknown, extras: Record<string, unknown> = {}) => ({
  ...extras,
  error: (error as Error)?.message ?? String(error),
  errorName: (error as Error)?.name,
});

const encodeUtf8Base64 = (value: string) => {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  return Buffer.from(value, "utf-8").toString("base64");
};

const safeParse = (raw: string | null): MediaIndexSnapshot | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MediaIndexSnapshot;
  } catch (error) {
    addLog(
      "warn",
      "Failed to parse persisted media index snapshot; will rebuild",
      describeError(error, { storagePath: STORAGE_PATH }),
    );
    return null;
  }
};

export class FilesystemMediaIndexStorage implements MediaIndexStorage {
  /**
   * Read through the WebView's file server rather than the Capacitor bridge.
   *
   * This is the same file the HVSC browse index is persisted to, and for a real HVSC it is 13.2 MB.
   * `Filesystem.readFile` returns a file as one base64 string in one bridge message: 1,084 ms and a
   * 17.6 MB intermediate string on a Pixel 4, against 258 ms through the file server. See
   * `readDataFileText`.
   */
  async read(): Promise<MediaIndexSnapshot | null> {
    try {
      return safeParse(await readDataFileText(STORAGE_PATH));
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        addLog(
          "warn",
          "Failed to read media index snapshot from filesystem",
          describeError(error, { storagePath: STORAGE_PATH }),
        );
      }
      return null;
    }
  }

  async write(snapshot: MediaIndexSnapshot): Promise<void> {
    try {
      await Filesystem.mkdir({
        directory: Directory.Data,
        path: "hvsc/index",
        recursive: true,
      });
    } catch (error) {
      if (!isDirectoryExistsError(error)) throw error;
    }
    await Filesystem.writeFile({
      directory: Directory.Data,
      path: STORAGE_PATH,
      data: encodeUtf8Base64(JSON.stringify(snapshot)),
      recursive: true,
    });
  }
}
