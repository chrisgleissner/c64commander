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
import { isDeviceAnswer } from "@/lib/sourceNavigation/connectionFailure";
import type { SourceEntry, SourceLocation } from "@/lib/sourceNavigation/types";

type ListingSource = Pick<SourceLocation, "id" | "type" | "listEntries" | "peekCachedEntries">;

/** While the device is marked unreachable, every this-many-th lookup tries it again. */
export const CONFIG_LOOKUP_PROBE_EVERY = 25;

/** The songlengths search asks only a few folders, so it asks the device again sooner. */
export const SONGLENGTHS_LOOKUP_PROBE_EVERY = 3;

export const CONFIG_LOOKUP_SKIPPED_NOTICE = "Settings files were not looked up while the device could not be reached.";
export const SONGLENGTHS_LOOKUP_SKIPPED_NOTICE =
  "Settings and song length files were not looked up while the device could not be reached.";

/**
 * The folder listing used to look for settings files, and for songlengths files, beside the files of one add.
 * Both lookups share what is known about the device and keep their own schedule for asking it again.
 *
 * Looking for them is optional, so once the phone knows it is offline, or a listing from the device has
 * failed without an answer from the device, the remaining folders are answered from the source's cache (or as
 * empty) instead of each waiting for its own connection timeout. Every CONFIG_LOOKUP_PROBE_EVERY-th lookup asks the
 * device again. Until one lookup has been answered the lookups run one at a time, so a first failure is seen before
 * the next folder is asked; after that they run together, as many as the FTP client allows.
 *
 * Lookups are ordered by when they started. A failure counts only if its lookup started after the latest answered
 * lookup started, and an answer counts only if its lookup started after the latest failed lookup started. What was
 * skipped is counted so the add can say so. A cancel ends lookups at once; a request already sent finishes unobserved.
 */
export const createConfigListing = (
  source: ListingSource,
  signal?: AbortSignal,
  options?: { songlengths?: boolean },
) => {
  const notice = options?.songlengths ? SONGLENGTHS_LOOKUP_SKIPPED_NOTICE : CONFIG_LOOKUP_SKIPPED_NOTICE;
  let deviceUnreachable = false;
  let deviceAnswered = false;
  let lookupsStarted = 0;
  let lastFailureStart = 0;
  let lastSuccessStart = 0;
  let skipped = 0;
  let noticeLogged = false;
  let chain: Promise<unknown> = Promise.resolve();

  const abortError = () => {
    if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  };
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        if (signal.aborted) reject(abortError());
        else signal.addEventListener("abort", () => reject(abortError()), { once: true });
      })
    : null;
  aborted?.catch(() => undefined);

  const makeListEntries = (probeEvery: number) => {
    let sinceLastProbe = 0;
    const lookUp = async (path: string): Promise<SourceEntry[]> => {
      if (signal?.aborted) throw abortError();
      const fromDevice = source.type === "ultimate" && !isSimulatedDeviceTarget();
      const probing = deviceUnreachable && (sinceLastProbe += 1) >= probeEvery;
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
        deviceAnswered = true;
      };
      try {
        const pending = source.listEntries(path);
        const entries = await (aborted ? Promise.race([pending, aborted]) : pending);
        answered();
        return entries;
      } catch (error) {
        if (!fromDevice || (error as Error)?.name === "AbortError") throw error;
        if (isDeviceAnswer(error)) {
          answered();
        } else {
          skipped += 1;
          if (started > lastSuccessStart) {
            lastFailureStart = Math.max(lastFailureStart, started);
            deviceUnreachable = true;
            deviceAnswered = false;
          }
        }
        throw error;
      }
    };

    return (path: string): Promise<SourceEntry[]> => {
      if (deviceAnswered) return lookUp(path);
      const run = chain.then(() => lookUp(path));
      chain = run.catch(() => undefined);
      return run;
    };
  };

  return {
    listEntries: makeListEntries(CONFIG_LOOKUP_PROBE_EVERY),
    listSonglengthsFolder: makeListEntries(SONGLENGTHS_LOOKUP_PROBE_EVERY),
    /** The scan of the add listed folders from the device, so lookups need not be run one at a time. */
    noteDeviceAnswered: () => {
      lookupsStarted += 1;
      lastSuccessStart = Math.max(lastSuccessStart, lookupsStarted);
      deviceUnreachable = false;
      deviceAnswered = true;
    },
    skippedLookups: () => skipped,
    /** Logs what was skipped and returns the notice for the add's message, or "" when nothing was. */
    skippedNotice: () => {
      if (skipped === 0) return "";
      if (!noticeLogged) {
        noticeLogged = true;
        addLog(
          "warn",
          `${options?.songlengths ? "Settings and song length" : "Settings"} files were not looked up in some folders: the device could not be reached`,
          {
            sourceId: source.id,
            folders: skipped,
          },
        );
      }
      return notice;
    },
  };
};
