/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useEffect, useRef, useState } from "react";

import { bandsEqual } from "@/lib/audio/tone/toneCurve";

export const MORPH_MS = 180;

const motionReduced = () =>
  typeof document === "undefined" || document.documentElement.classList.contains("c64-motion-reduced");

/** A critically damped settle: fast start, no overshoot, so the curve never wobbles past its target. */
export const settle = (t: number): number => {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped >= 1 ? 1 : 1 - (1 + 7 * clamped) * Math.exp(-7 * clamped);
};

/**
 * The bands to draw. A change made elsewhere (a preset, a reset) morphs there in {@link MORPH_MS}; a change
 * marked `immediate` (a drag or a key step) and any change under reduced motion is drawn at once.
 */
export const useMorphedBands = (bandsDb: readonly number[], animate: boolean, immediate: { current: boolean }) => {
  const [shown, setShown] = useState<readonly number[]>(bandsDb);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const from = shownRef.current;
    const instant = immediate.current || !animate || motionReduced() || from.length !== bandsDb.length;
    immediate.current = false;
    if (instant || bandsEqual(from, bandsDb)) {
      setShown(bandsDb);
      return undefined;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = (now - start) / MORPH_MS;
      if (t >= 1) {
        setShown(bandsDb);
        return;
      }
      const k = settle(t);
      setShown(from.map((value, band) => value + (bandsDb[band] - value) * k));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [bandsDb, animate, immediate]);

  return shown;
};
