/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { avMirrorSession } from "@/lib/streams/avMirrorSession";
import { STATS_TICK_MS } from "@/hooks/useStreamStats";
import { installAvMirrorBackgroundPolicy } from "@/lib/streams/avMirrorBackgroundPolicy";

/**
 * App-wide Live View governor + telemetry lifecycle. The session's timer-free {@link avMirrorSession.tick}
 * must advance on a low-rate interval whenever a stream is live — NOT only while the Home "Stats" panel
 * happens to be mounted. Mounted once at the app root ({@link AppRoutes}), so:
 *   - the governor keeps protecting audio (demote video on underrun) in game mode, on the Play page,
 *     or with Stats closed;
 *   - INPUT PRIORITY recovers the video cadence after an input burst (the recovery runs in tick());
 *   - bounded telemetry keeps recording, so the diagnostics export isn't frozen at whatever the last
 *     Stats-open moment captured.
 *
 * Renders nothing. Ticking only while live avoids recording idle samples; the ~4 Hz read is cheap and
 * does not touch the streaming hot paths (§12.3). This is the SINGLE tick owner — {@link useStreamStats}
 * only subscribes to the resulting snapshots, so the governor is never advanced twice per cadence
 * (which would double-count audio pressure and over-demote).
 */
export function AvMirrorGovernorDriver() {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (avMirrorSession.audioLive || avMirrorSession.videoLive) avMirrorSession.tick();
    }, STATS_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  // HARD27-021: the same app-wide mount owns the mirror's backgrounding policy, so hiding the app
  // stops the streams instead of leaving the phone receiving and the Ultimate multicasting.
  useEffect(() => installAvMirrorBackgroundPolicy(), []);
  return null;
}
