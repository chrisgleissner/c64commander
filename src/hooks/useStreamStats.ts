/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { avMirrorSession, type AvMirrorSession, type AvStatsSnapshot } from "@/lib/streams/avMirrorSession";
import {
  loadStreamVideoFrameRateMode,
  saveStreamVideoFrameRateMode,
  type StreamVideoFrameRateMode,
} from "@/lib/config/appSettings";
import type { FrameRateMode } from "@/lib/streams/streamGovernor";
import type { TelemetryBucket } from "@/lib/streams/streamTelemetry";

/** Telemetry tick cadence (Hz→ms). 4 Hz keeps Stats live without materially touching streaming cost. */
export const STATS_TICK_MS = 250;

/**
 * React binding for the Live View **Stats** view. It:
 *   - drives the session's timer-free {@link AvMirrorSession.tick} on a low-rate interval while a
 *     stream is live (so the governor + telemetry advance), and
 *   - subscribes to the resulting Stats snapshots.
 *
 * The interval is owned here (proper cleanup on unmount) so the session stays a pure class. Ticking
 * only while live avoids recording idle samples. Opening/closing Stats only adds this ~4 Hz read;
 * it does not change the streaming hot paths (§12.3).
 */
export const useStreamStats = (session: AvMirrorSession = avMirrorSession, tickMs: number = STATS_TICK_MS) => {
  const [stats, setStats] = useState<AvStatsSnapshot>(() => session.getStatsSnapshot());
  const [requestedMode, setRequestedMode] = useState<StreamVideoFrameRateMode>(() => loadStreamVideoFrameRateMode());

  useEffect(() => session.subscribeStats(setStats), [session]);

  useEffect(() => {
    const id = setInterval(() => {
      if (session.audioLive || session.videoLive) session.tick();
    }, tickMs);
    return () => clearInterval(id);
  }, [session, tickMs]);

  const setFrameRateMode = useCallback(
    (mode: StreamVideoFrameRateMode) => {
      saveStreamVideoFrameRateMode(mode);
      session.setFrameRateMode(mode as FrameRateMode);
      setRequestedMode(mode);
    },
    [session],
  );

  const history = useCallback((windowSec: number): TelemetryBucket[] => session.statsHistory(windowSec), [session]);

  const exportDiagnostics = useCallback(
    (meta: Record<string, unknown> = {}): Record<string, unknown> => session.exportDiagnostics(meta),
    [session],
  );

  return useMemo(
    () => ({ stats, requestedMode, setFrameRateMode, history, exportDiagnostics, session }),
    [stats, requestedMode, setFrameRateMode, history, exportDiagnostics, session],
  );
};
