/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { flushSync } from "react-dom";

/** The new second shows this long after it turns, so a timer that fires a little early still shows it. */
const AFTER_SECOND_MS = 5;
/** How soon a moved start (a seek, a resync) shows: the next check is never further away than this. */
const CHECK_MS = 100;
/** However slow a tick's render measures, it is never started earlier than this. */
const MAX_LEAD_MS = 250;

/** Milliseconds after `now` until just after the elapsed time of a track started at `startedAtMs` next turns a second. */
export const msUntilNextSecond = (startedAtMs: number | null, now: number): number => {
  if (startedAtMs === null) return 1000;
  const sinceShowing = (((now - startedAtMs - AFTER_SECOND_MS) % 1000) + 1000) % 1000;
  return 1000 - sinceShowing;
};

/**
 * Run `tick` now and then as each second of the track's elapsed time turns, rather than once a second
 * at whatever phase the timer happened to start: a plain one-second interval shows each second up to
 * a second after the C64's own clock does. `tick` is given the moment its render will be on screen
 * and renders synchronously; how long that takes (about 60 ms for the Play page on a Pixel 4) is
 * measured, and the next tick starts that much before its second turns. The start can move at any
 * time, so the elapsed second is checked at least every `CHECK_MS`, and `tick` runs when it turns,
 * or a second after it last ran.
 */
export const useSecondAlignedTicks = (
  tick: (shownAtMs: number) => void,
  enabled: boolean,
  startedAtRef: { readonly current: number | null },
) => {
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let lastSecond: number | null = null;
    let lastShownAt = Number.NEGATIVE_INFINITY;
    let leadMs = 0;
    let aimedAt: number | null = null;
    const secondAt = (at: number) =>
      startedAtRef.current === null ? null : Math.floor((at - startedAtRef.current) / 1000);
    const run = () => {
      const now = Date.now();
      const shownAt = Math.max(now, aimedAt ?? now);
      aimedAt = null;
      if (secondAt(shownAt) !== lastSecond || shownAt - lastShownAt >= 1000) {
        flushSync(() => tick(shownAt));
        leadMs = Math.min(MAX_LEAD_MS, leadMs * 0.7 + (Date.now() - now) * 0.3);
        lastShownAt = shownAt;
        lastSecond = secondAt(shownAt);
      }
      const from = Math.max(Date.now(), lastShownAt);
      const showAt = from + msUntilNextSecond(startedAtRef.current, from);
      const untilFire = showAt - leadMs - Date.now();
      // A check that landed inside the margin before the aim would show the second as it turns, a few ms early.
      const aim = untilFire <= CHECK_MS + AFTER_SECOND_MS;
      if (aim) aimedAt = showAt;
      timer = window.setTimeout(run, aim ? Math.max(0, untilFire) : CHECK_MS);
    };
    run();
    return () => window.clearTimeout(timer);
  }, [enabled, startedAtRef, tick]);
};
