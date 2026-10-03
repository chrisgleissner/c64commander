/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Resolves once a focus-ring re-scan scheduled by a DOM change has run. The engine runs it after the
 * next paint: an animation frame, then a timer. The extra frame covers a mutation whose observer
 * callback is still queued when this is called.
 */
export const afterRingRescan = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
  });
