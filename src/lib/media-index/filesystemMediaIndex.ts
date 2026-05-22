/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from "@capacitor/filesystem";
import { addLog } from "@/lib/logging";
import type { MediaIndexSnapshot, MediaIndexStorage } from "./mediaIndex";

const STORAGE_PATH = "hvsc/index/media-index-v2.json";

const isFileNotFoundError = (error: unknown) => {
  const message = ((error as { message?: unknown })?.message ?? "").toString();
  return /not found|ENOENT|does not exist|no such file|File does not exist/i.test(message);
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

const decodeUtf8Base64 = (value: string) => {
  try {
    if (typeof atob === "function") {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(value, "base64").toString("utf-8");
  } catch (error) {
    addLog("warn", "Failed to decode media-index base64 payload", describeError(error));
    return value;
  }
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
  async read(): Promise<MediaIndexSnapshot | null> {
    try {
      const result = await Filesystem.readFile({
        directory: Directory.Data,
        path: STORAGE_PATH,
      });
      const decoded = typeof result.data === "string" ? decodeUtf8Base64(result.data) : null;
      return safeParse(decoded);
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
    await Filesystem.mkdir({
      directory: Directory.Data,
      path: "hvsc/index",
      recursive: true,
    });
    await Filesystem.writeFile({
      directory: Directory.Data,
      path: STORAGE_PATH,
      data: encodeUtf8Base64(JSON.stringify(snapshot)),
      recursive: true,
    });
  }
}
