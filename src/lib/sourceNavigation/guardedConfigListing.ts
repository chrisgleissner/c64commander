/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isSimulatedDeviceTarget } from "@/lib/connection/connectionManager";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { addLog } from "@/lib/logging";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";
import type { SourceEntry, SourceLocation } from "@/lib/sourceNavigation/types";

type ListingSource = Pick<SourceLocation, "id" | "type" | "listEntries" | "peekCachedEntries">;

/** While the device is marked unreachable, every this-many-th lookup tries it again. */
export const CONFIG_LOOKUP_PROBE_EVERY = 25;

/** What a failed device listing says when the device or the network is gone. */
const LOST_CONNECTION_PATTERN =
  /timed out|timeout|unable to resolve host|connection reset|connection abort|software caused|no route to host|network is unreachable|enetunreach|broken pipe/i;

const isConnectionFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return LOST_CONNECTION_PATTERN.test(message) || isTransientConnectivityFailure(message);
};

export const CONFIG_LOOKUP_SKIPPED_NOTICE = "Settings files were not looked up while the device could not be reached.";

/**
 * The folder listing used to look for settings files beside the files of one add.
 *
 * Looking for a settings file is optional, so once the phone knows it is offline, or one listing from the device
 * has failed to connect, the remaining folders are answered from the source's cache (or as empty) instead of
 * each waiting for its own connection timeout. Every CONFIG_LOOKUP_PROBE_EVERY-th lookup asks the device again, so a
 * device that was only briefly refusing is used again. Lookups run one at a time, so the first failure is seen
 * before the next folder is asked. What was skipped is counted so the add can say so.
 */
export const createConfigListing = (source: ListingSource) => {
  let deviceUnreachable = false;
  let skipped = 0;
  let sinceLastProbe = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const lookUp = async (path: string): Promise<SourceEntry[]> => {
    const fromDevice = source.type === "ultimate" && !isSimulatedDeviceTarget();
    const probing = deviceUnreachable && (sinceLastProbe += 1) >= CONFIG_LOOKUP_PROBE_EVERY;
    if (fromDevice && ((deviceUnreachable && !probing) || isNetworkKnownOffline())) {
      skipped += 1;
      return source.peekCachedEntries?.(path) ?? [];
    }
    if (probing) sinceLastProbe = 0;
    try {
      const entries = await source.listEntries(path);
      deviceUnreachable = false;
      return entries;
    } catch (error) {
      if (fromDevice && isConnectionFailure(error)) {
        deviceUnreachable = true;
        skipped += 1;
      }
      throw error;
    }
  };

  const listEntries = (path: string): Promise<SourceEntry[]> => {
    const run = chain.then(() => lookUp(path));
    chain = run.catch(() => undefined);
    return run;
  };

  return {
    listEntries,
    skippedLookups: () => skipped,
    /** Logs what was skipped and returns the notice for the add's message, or "" when nothing was. */
    skippedNotice: () => {
      if (skipped === 0) return "";
      addLog("warn", "Settings files were not looked up in some folders: the device could not be reached", {
        sourceId: source.id,
        folders: skipped,
      });
      return CONFIG_LOOKUP_SKIPPED_NOTICE;
    },
  };
};
