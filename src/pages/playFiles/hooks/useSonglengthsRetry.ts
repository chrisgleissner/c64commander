/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { useConnectionState } from "@/hooks/useConnectionState";
import { addLog } from "@/lib/logging";
import { isSonglengthsFileName } from "@/lib/sid/songlengthsDiscovery";
import { createUltimateSourceLocation } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { createConfigListing } from "@/lib/sourceNavigation/guardedConfigListing";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { buildUltimateSonglengthsFile } from "@/pages/playFiles/handlers/ultimateSonglengthsFile";
import {
  clearSkippedSonglengthsFolders,
  getSkippedSonglengthsFolders,
  resolveSkippedSonglengthsFolders,
} from "@/pages/playFiles/songlengthsRetryStore";
import type { SonglengthsFileEntry } from "@/pages/playFiles/hooks/useSonglengths";

type SonglengthsRetryOptions = {
  deviceId: string;
  playlistLength: number;
  mergeSonglengthsFiles: (entries: SonglengthsFileEntry[]) => void;
};

const ignoreProgress = () => undefined;

/**
 * Looks for the songlengths files an add could not look for because the device did not answer, as soon as the
 * device answers again. A new connection state ends a run that is still going; a device that drops again ends it
 * too, and the folders it did not reach stay stored for the next time.
 */
export const useSonglengthsRetry = ({ deviceId, playlistLength, mergeSonglengthsFiles }: SonglengthsRetryOptions) => {
  const { state } = useConnectionState();
  const mergeRef = useRef(mergeSonglengthsFiles);
  mergeRef.current = mergeSonglengthsFiles;

  useEffect(() => {
    if (playlistLength === 0) clearSkippedSonglengthsFolders(deviceId);
  }, [deviceId, playlistLength]);

  useEffect(() => {
    if (state !== "REAL_CONNECTED") return;
    const controller = new AbortController();

    const runOnce = async () => {
      const folders = getSkippedSonglengthsFolders(deviceId);
      if (!folders.length) return;
      const listing = createConfigListing(createUltimateSourceLocation(), controller.signal, { songlengths: true });
      const resolved: string[] = [];
      const found: string[] = [];
      for (const folder of folders) {
        if (controller.signal.aborted) break;
        let entries;
        try {
          entries = await listing.listSonglengthsFolder(folder);
        } catch (error) {
          if ((error as { name?: string } | null)?.name !== "AbortError") {
            addLog("info", "Songlengths retry ended: the device did not answer", {
              folder,
              error: (error as Error).message,
            });
          }
          break;
        }
        if (listing.skippedLookups() > 0) break;
        resolved.push(folder);
        const songEntry = entries.find((entry) => entry.type === "file" && isSonglengthsFileName(entry.name));
        if (!songEntry) continue;
        const path = normalizeSourcePath(songEntry.path);
        mergeRef.current([{ path, file: buildUltimateSonglengthsFile(songEntry, () => undefined, ignoreProgress) }]);
        found.push(path);
      }
      resolveSkippedSonglengthsFolders(deviceId, resolved);
      addLog("info", "Songlengths retry finished", {
        tried: resolved.length,
        found,
        remaining: folders.length - resolved.length,
      });
    };

    void runOnce().catch((error) => {
      addLog("warn", "Songlengths retry failed", { error: (error as Error).message });
    });
    return () => {
      controller.abort();
    };
  }, [deviceId, state]);
};
