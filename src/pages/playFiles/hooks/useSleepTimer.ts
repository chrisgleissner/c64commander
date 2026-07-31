/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { addLog } from "@/lib/logging";
import { hasElapsed, shouldStopAfterTune, SLEEP_TIMER_OFF, type SleepTimerMode } from "@/lib/playback/sleepTimer";

export type UseSleepTimerParams = {
  /** Stop playback. Called once, from whichever of the two conditions fires first. */
  onExpire: () => void;
  /** True while something is playing; an armed timer with nothing playing has nothing to stop. */
  isPlaying: boolean;
};

export type SleepTimerState = {
  mode: SleepTimerMode;
  setMode: (mode: SleepTimerMode) => void;
  /** Ticks once a second while a timed sleep timer is armed, and is otherwise static. */
  nowMs: number;
  /** Call when a tune finishes. Returns true when playback should stop instead of advancing. */
  notifyTuneEnded: () => boolean;
};

/**
 * The sleep timer, running.
 *
 * The two kinds expire on different things — one on the clock, one on a tune ending — so they are
 * checked in different places rather than forced through a single mechanism. The clock is polled
 * once a second, and only while a timed one is armed: an interval running for a timer that is off
 * would wake the phone every second for nothing.
 */
export const useSleepTimer = ({ onExpire, isPlaying }: UseSleepTimerParams): SleepTimerState => {
  const [mode, setMode] = useState<SleepTimerMode>(SLEEP_TIMER_OFF);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Held in a ref so the interval below does not have to be torn down and rebuilt whenever the page
  // re-renders with a new closure, which on this page is often.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const disarm = useCallback(() => setMode(SLEEP_TIMER_OFF), []);

  useEffect(() => {
    if (mode.kind !== "timed") return;
    /**
     * Whether this arming has already expired.
     *
     * `disarm()` is a state update, so it does not stop this interval — React has to re-render and
     * tear the effect down first, and the interval goes on ticking against the mode captured in
     * this closure until it does. Without this guard the expiry fires on every tick in between:
     * measured at 241 calls where one was intended. Scoped to the effect so a fresh arming gets a
     * fresh flag.
     */
    let fired = false;
    const tick = () => {
      if (fired) return;
      const now = Date.now();
      setNowMs(now);
      if (!hasElapsed(mode, now)) return;
      fired = true;
      addLog("info", "Sleep timer elapsed; stopping playback", { minutes: mode.minutes });
      disarm();
      // Fires whether or not anything is playing: the timer was set to end the session, and a
      // listener who stopped it themselves has already got what they asked for.
      onExpireRef.current();
    };
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [disarm, mode]);

  // Same hazard as the interval above: `disarm()` only takes effect on the next render, so two
  // track-end notifications arriving before it lands would both see an armed timer.
  const stoppedForTuneRef = useRef(false);
  useEffect(() => {
    if (mode.kind === "after-tune") stoppedForTuneRef.current = false;
  }, [mode]);

  const notifyTuneEnded = useCallback(() => {
    if (!shouldStopAfterTune(mode) || stoppedForTuneRef.current) return false;
    stoppedForTuneRef.current = true;
    addLog("info", "Sleep timer: stopping after this tune");
    disarm();
    onExpireRef.current();
    return true;
  }, [disarm, mode]);

  // An armed timer outlives a stop the listener made themselves only for as long as it takes to
  // notice: "after this tune" cannot fire once nothing is playing, so it is cleared rather than
  // left armed to surprise the next tune that starts.
  useEffect(() => {
    if (!isPlaying && mode.kind === "after-tune") disarm();
  }, [disarm, isPlaying, mode.kind]);

  return { mode, setMode, nowMs, notifyTuneEnded };
};
