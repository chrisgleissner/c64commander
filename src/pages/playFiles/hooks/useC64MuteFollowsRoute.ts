/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { useActivePlayback } from "@/hooks/useActivePlayback";
import { useC64Connection } from "@/hooks/useC64Connection";
import { addErrorLog } from "@/lib/logging";
import type { PlaybackRoute } from "@/lib/playback/playbackEngineRouting";
import type { VolumeState } from "@/pages/playFiles/volumeState";

/** The C64 route's mute, as `useVolumeOverride` exposes it. */
export type C64Mute = {
  volumeState: VolumeState;
  /** The Mute button, not a pause, is what holds the C64 muted. */
  isManualMuteHeld: () => boolean;
  /** Undo a mute the app wrote to the C64; resolves false when there was none to undo. */
  releaseManualMute: (reason: string) => Promise<boolean>;
};

type C64MuteFollowsRouteOptions = {
  route: PlaybackRoute;
  c64Mute: C64Mute;
  /** A SID is playing, so an engine switch moves it to this phone and restores the C64's volume itself. */
  sidPlaying: boolean;
  muteHere: () => void;
};

/**
 * The Play page's volume row controls only the route that is sounding. A Mute pressed on the C64 route
 * writes the Ultimate's mixer, so once the sound moves to this phone that mute is shown nowhere and the
 * Ultimate stays silent for whoever uses it next. When the route leaves the C64, the mute moves with it:
 * this phone is muted at once, and the C64's mixer is restored as soon as no tune is still being moved
 * off it (a moving tune's own stop restores the mixer, and an earlier write would be heard on the C64).
 * A pause also mutes the C64, but it is not the listener's Mute and does not move.
 */
export function useC64MuteFollowsRoute({ route, c64Mute, sidPlaying, muteHere }: C64MuteFollowsRouteOptions) {
  const { local: soundsHere } = useActivePlayback();
  const { status } = useC64Connection();
  const c64Reachable = status.state === "REAL_CONNECTED";
  const tuneMoving = sidPlaying && !soundsHere;
  const c64Muted = c64Mute.volumeState.muted;
  const actionsRef = useRef({ c64Mute, muteHere });
  actionsRef.current = { c64Mute, muteHere };
  const previousRouteRef = useRef(route);
  const releasingRef = useRef(false);

  useEffect(() => {
    const leftC64 = previousRouteRef.current === "c64" && route === "local";
    previousRouteRef.current = route;
    if (leftC64 && c64Muted && actionsRef.current.c64Mute.isManualMuteHeld()) actionsRef.current.muteHere();
  }, [c64Muted, route]);

  useEffect(() => {
    if (route !== "local" || !c64Muted || !c64Reachable || tuneMoving || releasingRef.current) return;
    releasingRef.current = true;
    void actionsRef.current.c64Mute
      .releaseManualMute("listening-route-left-c64")
      .catch((error) => {
        addErrorLog("C64 mute could not be released after the sound moved to this phone", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      })
      .finally(() => {
        releasingRef.current = false;
      });
  }, [c64Muted, c64Reachable, route, tuneMoving]);
}
