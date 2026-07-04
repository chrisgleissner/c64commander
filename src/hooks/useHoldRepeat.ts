/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef } from "react";

export type HoldRepeatControls = {
  /** Fire once immediately, then begin auto-repeating after the initial delay. */
  start: () => void;
  /** Stop repeating and cancel any pending initial delay. */
  stop: () => void;
};

/** Matches the default C64 KERNAL key-repeat feel: a pause, then a brisk repeat. */
const DEFAULT_INITIAL_DELAY_MS = 400;
const DEFAULT_REPEAT_INTERVAL_MS = 100;

/**
 * Auto-repeat a callback while a control is held, like a physical key: `start`
 * fires it once immediately, waits `initialDelayMs`, then repeats it every
 * `repeatIntervalMs` until `stop`. The latest `onRepeat` is always used (held in
 * a ref) so `start`/`stop` stay referentially stable, and both timers are torn
 * down on unmount so a held key can never keep firing against a gone component.
 */
export const useHoldRepeat = (
  onRepeat: () => void,
  options?: { initialDelayMs?: number; repeatIntervalMs?: number },
): HoldRepeatControls => {
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const repeatIntervalMs = options?.repeatIntervalMs ?? DEFAULT_REPEAT_INTERVAL_MS;
  const callbackRef = useRef(onRepeat);
  callbackRef.current = onRepeat;
  const initialTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (initialTimerRef.current !== null) {
      window.clearTimeout(initialTimerRef.current);
      initialTimerRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    callbackRef.current();
    initialTimerRef.current = window.setTimeout(() => {
      initialTimerRef.current = null;
      intervalRef.current = window.setInterval(() => callbackRef.current(), repeatIntervalMs);
    }, initialDelayMs);
  }, [initialDelayMs, repeatIntervalMs, stop]);

  useEffect(() => stop, [stop]);

  return { start, stop };
};
