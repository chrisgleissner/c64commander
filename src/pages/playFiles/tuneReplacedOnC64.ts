/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getC64API } from "@/lib/c64api";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { addLog } from "@/lib/logging";
import { isTuneStillPlayingOnC64 } from "@/lib/playback/tuneStillPlayingOnC64";
import { readSidBytes, type ResolveHvscRuntimeRequest } from "@/pages/playFiles/readSidBytes";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * Below this share of the tune's bytes the C64's memory holds another tune. Stricter than the 90% that says a tune
 * still plays: two HVSC tunes in 546 fall short of 90% while playing, and a doubt here must keep the playlist going.
 */
export const REPLACED_BELOW_SHARE = 0.5;
export const TUNE_REPLACED_CHECK_TIMEOUT_MS = 4000;
export const TUNE_REPLACED_ON_C64_MESSAGE =
  "The C64 is playing something else. Press Play to play this playlist again.";

/**
 * Whether the C64 no longer plays the SID this phone started on it: another app started a tune, or somebody used the
 * machine. Moving the playlist on would replace what they started. Any doubt, or no connection to ask over, answers
 * false, as before this check.
 */
export const isTuneReplacedOnC64 = async (
  item: PlaylistItem | undefined,
  resolveHvscRuntimeRequest: ResolveHvscRuntimeRequest,
): Promise<boolean> => {
  if (item?.category !== "sid") return false;
  if (isNetworkKnownOffline() || getConnectionSnapshot().state !== "REAL_CONNECTED") return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const check = (async () => {
      const bytes = await readSidBytes(item, resolveHvscRuntimeRequest);
      return bytes ? isTuneStillPlayingOnC64(getC64API(), bytes, undefined, REPLACED_BELOW_SHARE) : null;
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`No answer within ${TUNE_REPLACED_CHECK_TIMEOUT_MS} ms`)),
        TUNE_REPLACED_CHECK_TIMEOUT_MS,
      );
    });
    return (await Promise.race([check, timeout])) === false;
  } catch (error) {
    addLog("warn", "Playback: could not check whether the C64 still plays this tune; moving on as usual", {
      item: item.label,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
};
