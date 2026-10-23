/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Dispatch, SetStateAction } from "react";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import { normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import type { AddItemsProgressState } from "@/components/itemSelection/AddItemsProgressOverlay";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import { parseModifiedAt } from "@/pages/playFiles/playFilesUtils";

/** A transfer that delivers nothing for this long is given up, whether or not an add is running to cancel it. */
export const SONGLENGTHS_IDLE_TIMEOUT_MS = 60_000;

const formatMib = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/**
 * A songlengths file on the Ultimate, read over FTP when something asks for its bytes. The file belongs to the
 * Ultimate the add was aimed at when it was found, whatever device is selected when the read happens. The add
 * running at that moment can cancel the read; the idle timeout ends one that stalls with no add left to cancel it.
 */
export const buildUltimateSonglengthsFile = (
  entry: { path: string; name: string; modifiedAt?: string | null; sizeBytes?: number | null },
  runningAddSignal: () => AbortSignal | undefined,
  setAddItemsProgress: Dispatch<SetStateAction<AddItemsProgressState>>,
): LocalPlayFile => {
  const normalizedPath = normalizeSourcePath(entry.path);
  const { deviceHost, password = "" } = getC64APIConfigSnapshot();
  const totalBytes = typeof entry.sizeBytes === "number" && entry.sizeBytes > 0 ? entry.sizeBytes : 0;
  return {
    name: entry.name,
    webkitRelativePath: normalizedPath,
    lastModified: parseModifiedAt(entry.modifiedAt) ?? Date.now(),
    arrayBuffer: async () => {
      const signal = runningAddSignal();
      try {
        const { data } = await readFtpFile({
          host: normalizeFtpHost(deviceHost),
          port: getStoredFtpPort(),
          password,
          path: normalizedPath,
          timeoutMs: SONGLENGTHS_IDLE_TIMEOUT_MS,
          totalBytes,
          signal,
          onProgress: ({ bytesRead, totalBytes: total }) => {
            const readMib = formatMib(bytesRead);
            const message =
              total > 0
                ? `Reading song-length database… ${readMib} / ${formatMib(total)} MB`
                : `Reading song-length database… ${readMib} MB`;
            setAddItemsProgress((prev) => ({ ...prev, message }));
          },
        });
        const bytes = base64ToUint8(data);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      } catch (error) {
        if (!signal?.aborted) throw error;
        const canceled = new Error("Songlengths read canceled", { cause: error });
        canceled.name = "AbortError";
        throw canceled;
      } finally {
        setAddItemsProgress((prev) =>
          typeof prev.message === "string" && prev.message.startsWith("Reading song-length database")
            ? { ...prev, message: "Scanning…" }
            : prev,
        );
      }
    },
  };
};
