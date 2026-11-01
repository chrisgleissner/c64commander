/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, type MutableRefObject } from "react";
import { registerDeviceRelease, untilAborted } from "@/lib/appMode/deviceRelease";
import { getC64API } from "@/lib/c64api";
import { isRemotePlaybackActive, markRemotePlaybackStopped } from "@/lib/playback/activePlaybackSession";

type TuneReleaseOptions = {
  isPausedRef: MutableRefObject<boolean>;
  stopTuneOnC64: (
    api: ReturnType<typeof getC64API>,
    shouldReboot: boolean,
    itemId?: string,
    endMounts?: boolean,
  ) => Promise<void>;
};

export function useTuneReleaseOnSidPlayer({ isPausedRef, stopTuneOnC64 }: TuneReleaseOptions) {
  useEffect(
    () =>
      registerDeviceRelease(async (signal) => {
        if (!isRemotePlaybackActive() && !isPausedRef.current) return;
        try {
          await untilAborted(stopTuneOnC64(getC64API(), false, undefined, false), signal);
        } finally {
          markRemotePlaybackStopped();
        }
      }),
    [isPausedRef, stopTuneOnC64],
  );
}
