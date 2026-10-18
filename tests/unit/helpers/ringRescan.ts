/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const SLICE_TIMER_TICKS = 40;

/**
 * Resolves once a focus-ring re-scan scheduled by a DOM change has run. The engine runs it after the
 * next paint: an animation frame, then a timer. The extra frame covers a mutation whose observer
 * callback is still queued when this is called. The scan measures the page in timer-driven slices, so
 * the timer ticks that follow give a slow runner room to finish them.
 */
export const afterRingRescan = async () => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
  });
  for (let tick = 0; tick < SLICE_TIMER_TICKS; tick++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
