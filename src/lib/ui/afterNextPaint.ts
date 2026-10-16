/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Runs `run` once the next frame has been painted, and returns a function that cancels it.
 *
 * An animation frame callback runs before that frame's style, layout and paint, so work started
 * from one still delays the paint it was meant to follow. A task queued from the frame callback
 * runs after the paint.
 */
export const afterNextPaint = (run: () => void): (() => void) => {
  let cancelled = false;
  if (typeof requestAnimationFrame !== "function") {
    queueMicrotask(() => {
      if (!cancelled) run();
    });
    return () => {
      cancelled = true;
    };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    if (!cancelled) timer = setTimeout(run, 0);
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
};
