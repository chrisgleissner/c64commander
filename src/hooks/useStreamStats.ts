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
import type { TelemetryBucket } from "@/lib/streams/streamTelemetry";

/** Telemetry tick cadence (Hz→ms). 4 Hz keeps Stats live without materially touching streaming cost. */
export const STATS_TICK_MS = 250;

/**
 * React binding for the Live View **Stats** view. It subscribes to the session's Stats snapshots and
 * exposes the frame-rate control + history/export helpers.
 *
 * It does NOT drive the tick: the governor + telemetry lifecycle is owned app-wide by
 * {@link AvMirrorGovernorDriver} (mounted at the app root) so it keeps advancing whenever a stream is
 * live — in game mode, on another page, or with Stats closed — not only while this panel is mounted.
 * Opening/closing Stats only adds this subscription; it does not change the streaming hot paths (§12.3).
 */
export const useStreamStats = (session: AvMirrorSession = avMirrorSession, _tickMs: number = STATS_TICK_MS) => {
  const [stats, setStats] = useState<AvStatsSnapshot>(() => session.getStatsSnapshot());
  const [requestedMode, setRequestedMode] = useState<StreamVideoFrameRateMode>(() => loadStreamVideoFrameRateMode());

  useEffect(() => session.subscribeStats(setStats), [session]);

  const setFrameRateMode = useCallback(
    (mode: StreamVideoFrameRateMode) => {
      saveStreamVideoFrameRateMode(mode);
      session.setFrameRateMode(mode);
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
