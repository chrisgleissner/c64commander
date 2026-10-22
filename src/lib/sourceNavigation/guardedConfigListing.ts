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
import { classifyListingFailure, isTemporaryNameFailure } from "@/lib/sourceNavigation/connectionFailure";
import type { SourceEntry, SourceLocation } from "@/lib/sourceNavigation/types";

type ListingSource = Pick<SourceLocation, "id" | "type" | "listEntries" | "peekCachedEntries">;

/** While the device is marked unreachable, every this-many-th lookup tries it again. */
export const CONFIG_LOOKUP_PROBE_EVERY = 25;

export const CONFIG_LOOKUP_SKIPPED_NOTICE = "Settings files were not looked up while the device could not be reached.";

/**
 * The folder listing used to look for settings files beside the files of one add.
 *
 * Looking for a settings file is optional, so once the phone knows it is offline, or one listing from the device
 * has failed to connect, the remaining folders are answered from the source's cache (or as empty) instead of
 * each waiting for its own connection timeout. Every CONFIG_LOOKUP_PROBE_EVERY-th lookup asks the device again, so a
 * device that was only briefly refusing is used again, unless its name could not be resolved at all. Until one
 * lookup has succeeded the lookups run one at a time, so a first failure is seen before the next folder is asked;
 * after that they run together, as many as the FTP client allows. Only a lookup that started after the latest
 * failure can mark the device reachable again, and only a success or a reply from the device does. What was skipped
 * is counted so the add can say so. A cancel ends lookups at once; the request already sent finishes unobserved.
 */
export const createConfigListing = (source: ListingSource, signal?: AbortSignal) => {
  let deviceUnreachable = false;
  let nameNotFound = false;
  let deviceAnswered = false;
  let lookupsStarted = 0;
  let lastFailureStart = 0;
  let lastSuccessStart = 0;
  let skipped = 0;
  let sinceLastProbe = 0;
  let noticeLogged = false;
  let chain: Promise<unknown> = Promise.resolve();

  const abortError = () => new DOMException("Aborted", "AbortError");
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        if (signal.aborted) reject(abortError());
        else signal.addEventListener("abort", () => reject(abortError()), { once: true });
      })
    : null;
  aborted?.catch(() => undefined);

  const lookUp = async (path: string): Promise<SourceEntry[]> => {
    if (signal?.aborted) throw abortError();
    const fromDevice = source.type === "ultimate" && !isSimulatedDeviceTarget();
    const probing = deviceUnreachable && !nameNotFound && (sinceLastProbe += 1) >= CONFIG_LOOKUP_PROBE_EVERY;
    if (fromDevice && ((deviceUnreachable && !probing) || isNetworkKnownOffline())) {
      skipped += 1;
      return source.peekCachedEntries?.(path) ?? [];
    }
    if (probing) sinceLastProbe = 0;
    const started = (lookupsStarted += 1);
    const answered = () => {
      if (started < lastFailureStart) return;
      lastSuccessStart = Math.max(lastSuccessStart, started);
      deviceUnreachable = false;
      nameNotFound = false;
      deviceAnswered = true;
    };
    try {
      const pending = source.listEntries(path);
      const entries = await (aborted ? Promise.race([pending, aborted]) : pending);
      answered();
      return entries;
    } catch (error) {
      if (!fromDevice || (error as Error)?.name === "AbortError") throw error;
      const failure = classifyListingFailure(error);
      if (failure === "deviceReply") {
        answered();
      } else {
        skipped += 1;
        if (started > lastSuccessStart) {
          lastFailureStart = Math.max(lastFailureStart, started);
          deviceUnreachable = true;
          deviceAnswered = false;
          nameNotFound = failure === "nameFailure" && !isTemporaryNameFailure(error);
        }
      }
      throw error;
    }
  };

  const listEntries = (path: string): Promise<SourceEntry[]> => {
    if (deviceAnswered) return lookUp(path);
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
      if (!noticeLogged) {
        noticeLogged = true;
        addLog("warn", "Settings files were not looked up in some folders: the device could not be reached", {
          sourceId: source.id,
          folders: skipped,
        });
      }
      return CONFIG_LOOKUP_SKIPPED_NOTICE;
    },
  };
};
