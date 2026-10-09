/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";

/** A tick lands this long after the second turns over, so the elapsed time it reads shows the new second. */
const AFTER_SECOND_MS = 15;
const MIN_DELAY_MS = 50;
/** How soon a moved start (a seek, a resync) shows: the next check is never further away than this. */
const CHECK_MS = 100;

/** Milliseconds from `now` until just after the elapsed time of a track started at `startedAtMs` turns a second. */
export const msUntilNextSecond = (startedAtMs: number | null, now: number): number => {
  if (startedAtMs === null) return 1000;
  const intoSecond = (((now - startedAtMs) % 1000) + 1000) % 1000;
  return Math.max(MIN_DELAY_MS, 1000 - intoSecond + AFTER_SECOND_MS);
};

/**
 * Run `tick` now and then just after each second of the track's elapsed time, rather than once a
 * second at whatever phase the timer happened to start. A plain one-second interval shows each
 * second up to a second late, which is the difference between the time on the phone and the time
 * on the C64's screen. The start can move at any time, so the elapsed second is checked at least
 * every `CHECK_MS`, and `tick` runs when it turns, or a second after it last ran.
 */
export const useSecondAlignedTicks = (
  tick: () => void,
  enabled: boolean,
  startedAtRef: { readonly current: number | null },
) => {
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let lastSecond: number | null = null;
    let lastTickAt = Number.NEGATIVE_INFINITY;
    const secondNow = (now: number) =>
      startedAtRef.current === null ? null : Math.floor((now - startedAtRef.current) / 1000);
    const run = () => {
      const now = Date.now();
      if (secondNow(now) !== lastSecond || now - lastTickAt >= 1000) {
        tick();
        lastTickAt = Date.now();
        lastSecond = secondNow(lastTickAt);
      }
      // Within one check of the next second, aim just past it; otherwise check again soon.
      const untilNext = msUntilNextSecond(startedAtRef.current, Date.now());
      timer = window.setTimeout(run, untilNext <= CHECK_MS + AFTER_SECOND_MS ? untilNext : CHECK_MS);
    };
    run();
    return () => window.clearTimeout(timer);
  }, [enabled, startedAtRef, tick]);
};
