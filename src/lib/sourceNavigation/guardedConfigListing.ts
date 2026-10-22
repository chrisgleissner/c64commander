/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isSimulatedDeviceTarget } from "@/lib/connection/connectionManager";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";
import type { SourceEntry, SourceLocation } from "@/lib/sourceNavigation/types";

type ListingSource = Pick<SourceLocation, "type" | "listEntries" | "peekCachedEntries">;

/**
 * The folder listing used to look for settings files beside the files of one add.
 *
 * Looking for a settings file is optional, so once the phone knows it is offline, or one listing from the device
 * has failed to connect, the remaining folders are answered from the source's cache (or as empty) instead of
 * each waiting for its own connection timeout. What was skipped is counted so the add can say so.
 */
export const createConfigListing = (source: ListingSource) => {
  let deviceUnreachable = false;
  let skipped = 0;
  const listEntries = async (path: string): Promise<SourceEntry[]> => {
    const fromDevice = source.type === "ultimate" && !isSimulatedDeviceTarget();
    if (fromDevice && (deviceUnreachable || isNetworkKnownOffline())) {
      skipped += 1;
      return source.peekCachedEntries?.(path) ?? [];
    }
    try {
      return await source.listEntries(path);
    } catch (error) {
      if (fromDevice && isTransientConnectivityFailure(error instanceof Error ? error.message : String(error))) {
        deviceUnreachable = true;
      }
      throw error;
    }
  };
  return { listEntries, skippedLookups: () => skipped };
};
