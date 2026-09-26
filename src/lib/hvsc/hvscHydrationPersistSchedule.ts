/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const HYDRATION_PERSIST_INTERVAL_MS = 30_000;

export type HydrationPersistSchedule = {
  recordChange: () => void;
  shouldPersist: (isFinal: boolean, nowMs: number) => boolean;
  recordPersisted: (nowMs: number) => void;
};

/**
 * When metadata hydration writes the browse snapshot to disk.
 *
 * Every save serializes the whole library index, 13.2 MB for a real HVSC, and on a Pixel 4 the
 * copies that takes swung the renderer by hundreds of megabytes. Saves are therefore spaced
 * {@link HYDRATION_PERSIST_INTERVAL_MS} apart from the start of the run, the final chunk always
 * saves, and nothing is saved when nothing changed since the previous save.
 */
export const createHydrationPersistSchedule = (
  startedAtMs: number,
  intervalMs: number = HYDRATION_PERSIST_INTERVAL_MS,
): HydrationPersistSchedule => {
  let lastPersistedAtMs = startedAtMs;
  let changedSinceLastPersist = false;
  return {
    recordChange: () => {
      changedSinceLastPersist = true;
    },
    shouldPersist: (isFinal, nowMs) => changedSinceLastPersist && (isFinal || nowMs - lastPersistedAtMs >= intervalMs),
    recordPersisted: (nowMs) => {
      lastPersistedAtMs = nowMs;
      changedSinceLastPersist = false;
    },
  };
};
