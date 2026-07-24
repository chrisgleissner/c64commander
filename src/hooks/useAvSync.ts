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

/** Hold the SPACE key this long (~3 PAL frames) so the device's once-per-frame matrix poll sees it. */
const SPACE_HOLD_MS = 60;

/** How often to re-read the analyzer/tracker stats into React state, so values surface promptly. */
const STATS_REFRESH_MS = 250;

/**
 * A test program lives on the DEVICE, not in this component, so "a test is running" must survive the
 * panel unmounting (e.g. navigating away with the mirror off) and remounting — otherwise the only
 * Stop button vanishes while the program keeps running, leaving the user with no off-switch. This
 * module-scoped latch persists it across mounts for the app session (an SPA never reloads the module);
 * a full page reload can't know the device state regardless, so it legitimately starts clean.
 */
let deviceTestProgramActive = false;

/** Error detail carrying the stack (REVIEW.md §7) so a failed device op stays diagnosable in logs. */
const errorDetail = (error: unknown): { error: string; stack?: string } => {
  const e = error instanceof Error ? error : new Error(String(error));
  return { error: e.message, stack: e.stack };
};

/**
 * Binds the {@link AvSyncAnalyzer} to the shared A/V mirror session: every decoded video frame
 * and audio batch is stamped and fed to the analyzer, which matches the periodic white-flash /
 * tone "pops" and reports the audio↔video offset. The offset is measured from the WIRE-arrival
 * timestamp so asymmetric receive latency cannot skew it.
 *
 * Also drives the interactive space-triggered test ({@link AvLatencyTracker}): `runKeyTest()`
 * loads the av-sync-key program, then each `pressSpace()` sends SPACE over Remote Input and the
 * tracker measures press→see, press→hear (JS observe/render clock — the real end-to-end latency)
 * and the pop's A/V offset (wire clock). `stopTest()` resets the C64 to end whichever test program
 * is running. Both the sync stats and the latency stats surface the most recent value as soon as
 * it is available (not only once a percentile stabilises).
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
  /** Whether a test program is currently loaded/running on the device (so Stop can reset it). */
  const [testActive, setTestActiveState] = useState(deviceTestProgramActive);
  /** Persist across mounts via the module latch so a remount keeps the Stop button (see above). */
  const setTestActive = useCallback((active: boolean) => {
    deviceTestProgramActive = active;
    setTestActiveState(active);
  }, []);
  /** In-flight SPACE press (press → hold → release); stopTest awaits it so a reset can't preempt it. */
  const pendingKeyRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const analyzer = analyzerRef.current!;
    const latency = latencyRef.current!;
    const refresh = () => {
      setStats(analyzer.getStats());
      setLatencyStats(latency.getStats());
    };
    const unsubscribeFrames = session.subscribeFrames((frame, _height, arrivalMs) => {
      videoObserveRef.current = now();
      const offset = analyzer.pushVideoFrame(frame, arrivalMs);
      // A matched pop feeds the wire offset into the latency tracker and surfaces stats immediately.
      // Pass the observe time of the frame that completed the match so the tracker's window guard can
      // reject a match belonging to an abandoned earlier press.
      if (offset !== null) {
        latency.onMatchOffset(offset, videoObserveRef.current);
        refresh();
      }
    });
    const unsubscribeAudio = session.subscribeAudio((samples, arrivalMs) => {
      audioObserveRef.current = now();
      const offset = analyzer.pushAudioSamples(samples, arrivalMs);
      if (offset !== null) {
        latency.onMatchOffset(offset, audioObserveRef.current);
        refresh();
      }
    });
    // Backstop poll: surface see/hear pops (and unmatched-pop counts) promptly even between matches.
    const poll = setInterval(refresh, STATS_REFRESH_MS);
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
      setTestActive(true);
    } catch (error) {
      const detail = errorDetail(error);
      setTestError(detail.error);
      addLog("warn", "A/V sync: failed to start the test program", detail);
    } finally {
      setRunningTest(false);
    }
  }, [setTestActive]);

  const runKeyTest = useCallback(async () => {
    setRunningTest(true);
    setTestError(null);
    try {
      await runAvSyncKeyTest();
      setTestActive(true);
    } catch (error) {
      const detail = errorDetail(error);
      setTestError(detail.error);
      addLog("warn", "A/V sync: failed to start the space-triggered test program", detail);
    } finally {
      setRunningTest(false);
    }
  }, [setTestActive]);

  const pressSpace = useCallback(async () => {
    // Stamp the press the instant the user initiates it — the measured press→see/hear latency
    // then includes the full round trip (input → device → pop → stream back), the real thing.
    // The whole press→hold→release runs as one tracked operation (pendingKeyRef) so stopTest can
    // await it: without that, tapping Stop during the 60 ms hold would reset the C64 while SPACE is
    // still asserted and the queued release would land on a freshly-booted machine (and a FAILED
    // release would slip past the wedge log). The synchronous markPress below still runs at the
    // instant of the tap because the async body executes up to its first await eagerly.
    const op = (async () => {
      latencyRef.current!.markPress(now());
      setLatencyStats(latencyRef.current!.getStats());
      const api = getC64API();
      try {
        // HOLD the key, don't "tap": av-sync-key polls the CIA keyboard matrix once per frame, so a
        // sub-frame tap can fall between two polls and be missed. A press held ~3 frames guarantees
        // the poll sees the rising edge (verified on real hardware); the pop still fires on the press
        // instant, so the latency measurement is unaffected by the hold.
        await api.sendMachineInputBatch({
          events: [{ kind: "keyboard", inputs: ["space"], transition: "press" }],
        });
        await new Promise((resolve) => setTimeout(resolve, SPACE_HOLD_MS));
      } catch (error) {
        const detail = errorDetail(error);
        setTestError(detail.error);
        addLog("warn", "A/V sync: failed to send the SPACE keypress", detail);
      } finally {
        // Always release, so the key never sticks — a stuck SPACE keeps the matrix asserted and
        // blocks every later rising-edge poll (no more pops). If the release itself fails, that is
        // exactly the wedge we must surface, so log it (never swallow).
        try {
          await api.sendMachineInputBatch({
            events: [{ kind: "keyboard", inputs: ["space"], transition: "release" }],
          });
        } catch (error) {
          const detail = errorDetail(error);
          setTestError(detail.error);
          addLog("warn", "A/V sync: failed to release the SPACE keypress (key may be stuck)", detail);
        }
      }
    })();
    pendingKeyRef.current = op;
    try {
      await op;
    } finally {
      if (pendingKeyRef.current === op) pendingKeyRef.current = null;
    }
  }, []);

  /** Stop whichever test program is running by resetting the C64 (both tests are RAM-resident). */
  const stopTest = useCallback(async () => {
    setRunningTest(true);
    setTestError(null);
    try {
      // Let any in-flight SPACE press finish its release BEFORE we reset, so the release never lands
      // on a freshly-booted machine and a failing release is still logged (pressSpace owns that log).
      if (pendingKeyRef.current) {
        try {
          await pendingKeyRef.current;
        } catch {
          /* the press's own catch already surfaced + logged it */
        }
      }
      await getC64API().machineReset();
    } catch (error) {
      const detail = errorDetail(error);
      setTestError(detail.error);
      addLog("warn", "A/V sync: failed to reset the machine to stop the test", detail);
    } finally {
      setTestActive(false);
      setRunningTest(false);
    }
  }, [setTestActive]);

  return { stats, latencyStats, reset, runTest, runKeyTest, pressSpace, stopTest, testActive, runningTest, testError };
};
