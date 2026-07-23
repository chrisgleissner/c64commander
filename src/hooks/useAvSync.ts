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
import { AvLatencyTracker, type AvLatencyStats } from "@/lib/streams/avLatency";
import { runAvSyncTest } from "@/lib/streams/avSyncPrg";
import { runAvSyncKeyTest } from "@/lib/streams/avSyncKeyPrg";
import { getC64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Binds the {@link AvSyncAnalyzer} to the shared A/V mirror session: every decoded video frame
 * and audio batch is stamped and fed to the analyzer, which matches the periodic white-flash /
 * tone "pops" and reports the audio↔video offset. The offset is measured from the WIRE-arrival
 * timestamp so asymmetric receive latency cannot skew it.
 *
 * Also drives the interactive space-triggered test ({@link AvLatencyTracker}): `runKeyTest()`
 * loads the av-sync-key program, then each `pressSpace()` sends SPACE over Remote Input and the
 * tracker measures press→see, press→hear (JS observe/render clock — the real end-to-end latency)
 * and the pop's A/V offset (wire clock).
 */
export const useAvSync = (session: AvMirrorSession = avMirrorSession) => {
  const latencyRef = useRef<AvLatencyTracker | null>(null);
  if (!latencyRef.current) latencyRef.current = new AvLatencyTracker();
  // JS observe (render) time of the frame/audio being pushed — captured just before push so the
  // analyzer's synchronous onPop callback can pair a detected pop with its perceived time.
  const videoObserveRef = useRef(0);
  const audioObserveRef = useRef(0);

  const analyzerRef = useRef<AvSyncAnalyzer | null>(null);
  if (!analyzerRef.current) {
    analyzerRef.current = new AvSyncAnalyzer({}, (kind) => {
      if (kind === "video") latencyRef.current!.onVideoPop(videoObserveRef.current);
      else latencyRef.current!.onAudioPop(audioObserveRef.current);
    });
  }

  const [stats, setStats] = useState<AvSyncStats>(() => analyzerRef.current!.getStats());
  const [latencyStats, setLatencyStats] = useState<AvLatencyStats>(() => latencyRef.current!.getStats());
  const [runningTest, setRunningTest] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    const analyzer = analyzerRef.current!;
    const latency = latencyRef.current!;
    const unsubscribeFrames = session.subscribeFrames((frame, _height, arrivalMs) => {
      videoObserveRef.current = now();
      const offset = analyzer.pushVideoFrame(frame, arrivalMs);
      if (offset !== null) {
        latency.onMatchOffset(offset);
        setStats(analyzer.getStats());
        setLatencyStats(latency.getStats());
      }
    });
    const unsubscribeAudio = session.subscribeAudio((samples, arrivalMs) => {
      audioObserveRef.current = now();
      const offset = analyzer.pushAudioSamples(samples, arrivalMs);
      if (offset !== null) {
        latency.onMatchOffset(offset);
        setStats(analyzer.getStats());
        setLatencyStats(latency.getStats());
      }
    });
    // Reflect unmatched-pop / latency counts as they accrue, before the first match.
    const poll = setInterval(() => {
      setStats(analyzer.getStats());
      setLatencyStats(latency.getStats());
    }, 500);
    return () => {
      unsubscribeFrames();
      unsubscribeAudio();
      clearInterval(poll);
    };
  }, [session]);

  const reset = useCallback(() => {
    analyzerRef.current!.reset();
    latencyRef.current!.reset();
    setStats(analyzerRef.current!.getStats());
    setLatencyStats(latencyRef.current!.getStats());
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

  const runKeyTest = useCallback(async () => {
    setRunningTest(true);
    setTestError(null);
    try {
      await runAvSyncKeyTest();
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      setTestError(message);
      addLog("warn", "A/V sync: failed to start the space-triggered test program", { error: message });
    } finally {
      setRunningTest(false);
    }
  }, []);

  const pressSpace = useCallback(async () => {
    // Stamp the press the instant the user initiates it — the measured press→see/hear latency
    // then includes the full round trip (input → device → pop → stream back), the real thing.
    latencyRef.current!.markPress(now());
    setLatencyStats(latencyRef.current!.getStats());
    try {
      await getC64API().sendMachineInputBatch({
        events: [{ kind: "keyboard", inputs: ["space"], transition: "tap" }],
      });
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      setTestError(message);
      addLog("warn", "A/V sync: failed to send the SPACE keypress", { error: message });
    }
  }, []);

  return { stats, latencyStats, reset, runTest, runKeyTest, pressSpace, runningTest, testError };
};
