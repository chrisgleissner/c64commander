/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { HvscIngestion, type HvscNativeDownloadResult } from "@/lib/native/hvscIngestion";
import { addLog } from "@/lib/logging";
import { isPluginMethodUnimplemented } from "@/lib/native/pluginAvailability";

export type ResumableArchiveDownloadOptions = {
  /** Path under the app data directory, e.g. `hvsc/cache/HVSC_85.zip`. */
  relativeArchivePath: string;
  archiveName: string;
  downloadUrl: string;
  expectedTotalBytes: number | null;
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void;
};

/* Re-exported from its shared home so the existing callers and tests keep working. */
export { isPluginMethodUnimplemented };

// Cached because an unimplemented method stays unimplemented for the life of the process, and
// every probe otherwise writes another rejection into the log.
let nativeResumeSupported: boolean | null = null;

export const resetResumableDownloadSupportForTests = () => {
  nativeResumeSupported = null;
};

/**
 * Downloads the archive through the native resumable path, which continues an interrupted transfer
 * from the bytes already in the `.part` sidecar. Returns `null` where the platform has no such
 * method, so the caller can fall back to the whole-file download. See HARD27-028.
 */
export const downloadArchiveWithResume = async (
  options: ResumableArchiveDownloadOptions,
): Promise<HvscNativeDownloadResult | null> => {
  if (nativeResumeSupported === false) return null;

  const { relativeArchivePath, archiveName, downloadUrl, expectedTotalBytes, onProgress } = options;
  let listener: { remove: () => Promise<void> } | null = null;
  try {
    listener = await HvscIngestion.addDownloadProgressListener((event) => {
      if (event.relativeArchivePath && event.relativeArchivePath !== relativeArchivePath) return;
      onProgress(event.downloadedBytes, event.totalBytes > 0 ? event.totalBytes : null);
    });
  } catch (error) {
    addLog("warn", "Failed to attach the HVSC resumable download progress listener", {
      archiveName,
      error: (error as Error).message,
    });
  }

  try {
    const result = await HvscIngestion.downloadArchive({
      relativeArchivePath,
      url: downloadUrl,
      ...(expectedTotalBytes && expectedTotalBytes > 0 ? { expectedTotalBytes } : {}),
    });
    nativeResumeSupported = true;
    addLog("info", "HVSC archive downloaded through the resumable native path", {
      archiveName,
      totalBytes: result.totalBytes,
      resumedFromBytes: result.resumedFromBytes,
      transferredBytes: result.transferredBytes,
    });
    return result;
  } catch (error) {
    if (isPluginMethodUnimplemented(error)) {
      nativeResumeSupported = false;
      addLog("info", "HVSC resumable download is unavailable on this platform; downloading the whole archive", {
        archiveName,
      });
      return null;
    }
    nativeResumeSupported = true;
    throw error;
  } finally {
    if (listener) {
      await listener.remove().catch((error: unknown) => {
        addLog("warn", "Failed to remove the HVSC resumable download progress listener", {
          archiveName,
          error: (error as Error).message,
        });
      });
    }
  }
};
