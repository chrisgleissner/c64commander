/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type MachineTransitionTarget = "paused" | "running";

type TransitionEntry = {
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
  run: () => Promise<void>;
  target: MachineTransitionTarget;
};

export class SupersededMachineTransitionError extends Error {
  constructor(target: MachineTransitionTarget) {
    super(`Machine transition superseded before ${target}`);
    this.name = "SupersededMachineTransitionError";
  }
}

const createEntry = (target: MachineTransitionTarget, run: () => Promise<void>): TransitionEntry => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {
    target,
    run,
    promise,
    resolve,
    reject,
  };
};

export const createMachineTransitionCoordinator = () => {
  let activeEntry: TransitionEntry | null = null;
  let queuedEntry: TransitionEntry | null = null;

  const drain = () => {
    if (activeEntry || !queuedEntry) return;
    const entry = queuedEntry;
    queuedEntry = null;
    activeEntry = entry;
    void entry
      .run()
      .then(() => entry.resolve())
      .catch((error) => entry.reject(error as Error))
      .finally(() => {
        activeEntry = null;
        drain();
      });
  };

  return {
    request: (target: MachineTransitionTarget, run: () => Promise<void>) => {
      if (activeEntry?.target === target && !queuedEntry) {
        return activeEntry.promise;
      }
      if (queuedEntry?.target === target) {
        return queuedEntry.promise;
      }
      const nextEntry = createEntry(target, run);
      if (queuedEntry) {
        queuedEntry.reject(new SupersededMachineTransitionError(queuedEntry.target));
      }
      queuedEntry = nextEntry;
      drain();
      return nextEntry.promise;
    },
  };
};
