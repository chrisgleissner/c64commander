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

type C64MuteFollowsRouteOptions = {
  route: PlaybackRoute;
  /** The Play page's Mute is engaged on the C64 (not a pause mute). */
  c64Muted: boolean;
  /** A SID is playing, so an engine switch moves it to this phone and restores the C64's volume itself. */
  sidPlaying: boolean;
  /** Undo a mute the app wrote to the C64; resolves false when there was none to undo. */
  releaseC64Mute: (reason: string) => Promise<boolean>;
  muteHere: () => void;
};

/**
 * The Play page's volume row controls only the route that is sounding. A Mute pressed on the C64 route
 * writes the Ultimate's mixer, so once the sound moves to this phone that mute is shown nowhere and the
 * Ultimate stays silent for whoever uses it next. When the route leaves the C64, the mute moves with it:
 * this phone is muted at once, and the C64's mixer is restored as soon as no tune is still being moved
 * off it (a moving tune's own stop restores the mixer, and an earlier write would be heard on the C64).
 */
export function useC64MuteFollowsRoute({
  route,
  c64Muted,
  sidPlaying,
  releaseC64Mute,
  muteHere,
}: C64MuteFollowsRouteOptions) {
  const { local: soundsHere } = useActivePlayback();
  const { status } = useC64Connection();
  const c64Reachable = status.state === "REAL_CONNECTED";
  const tuneMoving = sidPlaying && !soundsHere;
  const actionsRef = useRef({ releaseC64Mute, muteHere });
  actionsRef.current = { releaseC64Mute, muteHere };
  const previousRouteRef = useRef(route);
  const releasingRef = useRef(false);

  useEffect(() => {
    const leftC64 = previousRouteRef.current === "c64" && route === "local";
    previousRouteRef.current = route;
    if (leftC64 && c64Muted) actionsRef.current.muteHere();
  }, [c64Muted, route]);

  useEffect(() => {
    if (route !== "local" || !c64Muted || !c64Reachable || tuneMoving || releasingRef.current) return;
    releasingRef.current = true;
    void actionsRef.current
      .releaseC64Mute("listening-route-left-c64")
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
