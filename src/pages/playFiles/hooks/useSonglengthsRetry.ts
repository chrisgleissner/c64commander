/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { useConnectionState } from "@/hooks/useConnectionState";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { splitSavedDeviceHostAndHttpPort } from "@/lib/savedDevices/host";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";
import { isSonglengthsFileName, mayHoldSonglengthsFile } from "@/lib/sid/songlengthsDiscovery";
import { createUltimateSourceLocation } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { isDeviceAnswer } from "@/lib/sourceNavigation/connectionFailure";
import { createConfigListing } from "@/lib/sourceNavigation/guardedConfigListing";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { buildUltimateSonglengthsFile } from "@/pages/playFiles/handlers/ultimateSonglengthsFile";
import {
  clearSkippedSonglengthsFolders,
  getSkippedSonglengthsFolders,
  pruneSkippedSonglengthsFolders,
  resolveSkippedSonglengthsFolders,
  subscribeSkippedSonglengthsFolders,
} from "@/pages/playFiles/songlengthsRetryStore";
import type { SonglengthsFileEntry } from "@/pages/playFiles/hooks/useSonglengths";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

type SonglengthsRetryOptions = {
  deviceId: string;
  savedDeviceIds: readonly string[];
  playlistLength: number;
  mergeSonglengthsFiles: (entries: SonglengthsFileEntry[], options?: { replaceFailed?: boolean }) => void;
};

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 300_000;
const RETRY_MAX_UNANSWERED_RUNS = 6;

const ignoreProgress = () => undefined;

const hostOf = (host: string) => splitSavedDeviceHostAndHttpPort(host).host.toLowerCase();

/** The selected saved device, and whether the API is aimed at that device's host, read from one snapshot. */
const isAimedAtDevice = (deviceId: string) => {
  const snapshot = getSavedDevicesSnapshot();
  const device = snapshot.devices.find((entry) => entry.id === snapshot.selectedDeviceId);
  return device?.id === deviceId && hostOf(device.host) === hostOf(getC64APIConfigSnapshot().deviceHost);
};

/**
 * Looks for the songlengths files an add could not look for because the device did not answer, once the device
 * answers. It runs when the connection to the selected device is up and the device has folders stored, so a new
 * connection state or a folder stored later starts it. A run that ends with the device not answering is tried
 * again after a wait that doubles, and a new run replaces one that is still going.
 */
export const useSonglengthsRetry = ({
  deviceId,
  savedDeviceIds,
  playlistLength,
  mergeSonglengthsFiles,
}: SonglengthsRetryOptions) => {
  const { state } = useConnectionState();
  const mergeRef = useRef(mergeSonglengthsFiles);
  mergeRef.current = mergeSonglengthsFiles;
  const [storeVersion, setStoreVersion] = useState(0);
  const [timerVersion, setTimerVersion] = useState(0);
  const waitMsRef = useRef(RETRY_BASE_MS);
  const hadItemsRef = useRef(false);
  const unansweredRunsRef = useRef(0);

  useEffect(() => subscribeSkippedSonglengthsFolders(() => setStoreVersion((version) => version + 1)), []);

  useEffect(() => {
    if (playlistLength > 0) hadItemsRef.current = true;
    else if (hadItemsRef.current) {
      hadItemsRef.current = false;
      clearSkippedSonglengthsFolders();
    }
  }, [playlistLength]);

  const savedDeviceKey = savedDeviceIds.join("|");
  useEffect(() => {
    pruneSkippedSonglengthsFolders(new Set(savedDeviceKey.split("|")));
  }, [savedDeviceKey]);

  useEffect(() => {
    unansweredRunsRef.current = 0;
  }, [deviceId, state, storeVersion]);

  useEffect(() => {
    if (state !== "REAL_CONNECTED") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runOnce = async () => {
      const folders = getSkippedSonglengthsFolders(deviceId).sort((a, b) => a.length - b.length);
      if (!folders.length) return;
      const listed = new Map<string, SourceEntry[]>();
      const listing = createConfigListing(createUltimateSourceLocation(), controller.signal, { songlengths: true });
      const resolved: string[] = [];
      const found: string[] = [];
      for (const folder of folders) {
        if (controller.signal.aborted || !isAimedAtDevice(deviceId)) break;
        if (!mayHoldSonglengthsFile(folder, listed)) {
          resolved.push(folder);
          continue;
        }
        let entries: Awaited<ReturnType<typeof listing.listSonglengthsFolder>> = [];
        try {
          entries = await listing.listSonglengthsFolder(folder);
          if (listing.skippedLookups() > 0) break;
        } catch (error) {
          if (!isDeviceAnswer(error)) {
            if ((error as { name?: string } | null)?.name !== "AbortError") {
              addLog("info", "Songlengths retry ended: the device did not answer", {
                folder,
                error: (error as Error).message,
              });
            }
            break;
          }
        }
        resolved.push(folder);
        listed.set(folder.replace(/(.)\/+$/, "$1"), entries);
        const songEntry = entries.find((entry) => entry.type === "file" && isSonglengthsFileName(entry.name));
        if (!songEntry) continue;
        const path = normalizeSourcePath(songEntry.path);
        mergeRef.current([{ path, file: buildUltimateSonglengthsFile(songEntry, () => undefined, ignoreProgress) }], {
          replaceFailed: true,
        });
        found.push(path);
      }
      resolveSkippedSonglengthsFolders(deviceId, resolved);
      const remaining = getSkippedSonglengthsFolders(deviceId).length;
      addLog("info", "Songlengths retry finished", { tried: resolved.length, found, remaining });
      if (controller.signal.aborted || remaining === 0) return;
      if (resolved.length > 0) waitMsRef.current = RETRY_BASE_MS;
      else unansweredRunsRef.current += 1;
      if (unansweredRunsRef.current >= RETRY_MAX_UNANSWERED_RUNS) return;
      timer = setTimeout(() => setTimerVersion((version) => version + 1), waitMsRef.current);
      waitMsRef.current = Math.min(waitMsRef.current * 2, RETRY_MAX_MS);
    };

    void runOnce().catch((error: Error) => {
      addLog("warn", "Songlengths retry failed", { error: error.message, stack: error.stack });
    });
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [deviceId, state, storeVersion, timerVersion]);
};
