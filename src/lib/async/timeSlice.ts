/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** How long a loop may run before it hands the main thread back; under one 60 Hz frame. */
export const DEFAULT_SLICE_BUDGET_MS = 12;

type SchedulerWithYield = { yield?: () => Promise<void> };

const nextTurn = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: SchedulerWithYield }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
};

export interface TimeSlicer {
  /** Whether the slice has used its budget. Cheap enough to ask once per item. */
  due(): boolean;
  /** Hands the main thread back for a turn of the event loop and starts a new slice. */
  yield(): Promise<void>;
}

export interface TimeSlicerOptions {
  budgetMs?: number;
  now?: () => number;
  wait?: () => Promise<void>;
  /** The clock is read once per this many calls to `due`. */
  checkEvery?: number;
}

/**
 * For a loop over tens of thousands of items: `if (slice.due()) await slice.yield();` once per item. A plain `await` per
 * item would allocate a promise each time, which on a slow phone costs more than the work in the loop. Key presses and
 * paints are handled between slices instead of after the whole loop.
 */
export const createTimeSlicer = ({
  budgetMs = DEFAULT_SLICE_BUDGET_MS,
  now = () => performance.now(),
  wait = nextTurn,
  checkEvery = 32,
}: TimeSlicerOptions = {}): TimeSlicer => {
  let sliceStartedAt = now();
  let calls = 0;
  return {
    due: () => {
      calls += 1;
      return calls % checkEvery === 0 && now() - sliceStartedAt >= budgetMs;
    },
    yield: async () => {
      await wait();
      sliceStartedAt = now();
    },
  };
};
