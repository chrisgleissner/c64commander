/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Make sure the C64's own KERNAL and BASIC are in hand, reading them from the connected machine.
 *
 * The accurate engine cannot render a single note without them, they are copyrighted so they cannot
 * be shipped, and nothing else fetched them — so a fresh install that chose "listen on this device"
 * produced silence, with no error and no notice. Measured on a Pixel 4: engine `local`, no stored
 * ROMs, zero audio players, microphone at room noise.
 *
 * This runs in the background rather than in front of playback. The tune starts immediately on the
 * kernal-free emulation and the images, once they arrive, are picked up by the next worker — which
 * is better than making the listener wait on a network round trip before hearing anything.
 */

import { getC64API } from "@/lib/c64api";
import { loadLocalEngineAutoRoms } from "@/lib/config/appSettings";
import { addLog } from "@/lib/logging";
import { fetchSystemRomsFromDevice } from "@/lib/roms/romFetchService";
import { hasCompleteRomSet } from "@/lib/roms/romStore";

/**
 * One attempt at a time, and one per session once it has failed.
 *
 * A device that will not give up its ROMs will not give them up on the next track either, and
 * retrying per tune would put a failed network round trip in front of every play for the rest of
 * the session.
 */
let inFlight: Promise<boolean> | null = null;
let failedThisSession = false;

/** Test seam: forget the single-flight and the failure latch. */
export const resetSystemRomFetchForTests = () => {
  inFlight = null;
  failedThisSession = false;
};

/**
 * Fetch the ROMs if they are missing and the user has not turned this off.
 *
 * Resolves true when a complete set is available afterwards. Never throws: this is a convenience,
 * and a machine that will not answer must not stop a tune from playing.
 */
export const ensureSystemRoms = async (): Promise<boolean> => {
  if (hasCompleteRomSet()) return true;
  if (!loadLocalEngineAutoRoms() || failedThisSession) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const api = getC64API();
      const result = await fetchSystemRomsFromDevice(api, "the connected C64");
      const complete = hasCompleteRomSet();
      addLog(complete ? "info" : "warn", "Read the C64 ROMs for on-device playback", {
        service: "playback",
        complete,
        outcomes: result.outcomes.map((outcome) => ({ kind: outcome.kind, ok: outcome.ok })),
      });
      if (!complete) failedThisSession = true;
      return complete;
    } catch (error) {
      // Not an error the listener needs to see: playback continues on the kernal-free emulation, and
      // the Settings row says plainly what is missing and how to get it.
      addLog("warn", "Could not read the C64 ROMs; on-device playback uses the lighter emulation", {
        service: "playback",
        error: error instanceof Error ? error.message : String(error),
      });
      failedThisSession = true;
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};
