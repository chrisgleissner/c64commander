/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { avMirrorSession, type AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { AvSyncAnalyzer, type AvSyncStats } from "@/lib/streams/avSync";
import { runAvSyncTest } from "@/lib/streams/avSyncPrg";
import { addLog } from "@/lib/logging";

/**
 * Binds the {@link AvSyncAnalyzer} to the shared A/V mirror session: every decoded video
 * frame and audio batch is timestamped on arrival and fed to the analyzer, which matches
 * the periodic white-flash / tone "pops" from the bundled av-sync-auto program and reports
 * the audio↔video offset statistics. `runTest()` uploads and runs that program on the device.
 */
export const useAvSync = (session: AvMirrorSession = avMirrorSession) => {
  const analyzerRef = useRef<AvSyncAnalyzer | null>(null);
  if (!analyzerRef.current) analyzerRef.current = new AvSyncAnalyzer();
  const [stats, setStats] = useState<AvSyncStats>(() => analyzerRef.current!.getStats());
  const [runningTest, setRunningTest] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    const analyzer = analyzerRef.current!;
    // Offset is measured from the WIRE-ARRIVAL timestamp (native: stamped off the socket before
    // any decode; web: message receipt) so the asymmetric video-assembly vs audio latency cannot
    // skew it. `now()` (JS observe/render time) is reserved for press→see/hear latency (Phase 3).
    const unsubscribeFrames = session.subscribeFrames((frame, _height, arrivalMs) => {
      if (analyzer.pushVideoFrame(frame, arrivalMs) !== null) setStats(analyzer.getStats());
    });
    const unsubscribeAudio = session.subscribeAudio((samples, arrivalMs) => {
      if (analyzer.pushAudioSamples(samples, arrivalMs) !== null) setStats(analyzer.getStats());
    });
    // Reflect unmatched-pop counts as they accrue, so the panel updates before the first match.
    const poll = setInterval(() => setStats(analyzer.getStats()), 500);
    return () => {
      unsubscribeFrames();
      unsubscribeAudio();
      clearInterval(poll);
    };
  }, [session]);

  const reset = useCallback(() => {
    analyzerRef.current!.reset();
    setStats(analyzerRef.current!.getStats());
  }, []);

  const runTest = useCallback(async () => {
    setRunningTest(true);
    setTestError(null);
    try {
      await runAvSyncTest();
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      setTestError(message);
      addLog("warn", "A/V sync: failed to start the test program", { error: message });
    } finally {
      setRunningTest(false);
    }
  }, []);

  return { stats, reset, runTest, runningTest, testError };
};
