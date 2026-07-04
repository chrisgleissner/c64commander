/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type PendingJob<T> = {
  version: number;
  value: T;
};

type Waiter = {
  reject: (error: Error) => void;
  resolve: () => void;
};

export type LatestIntentWriteLane<T> = {
  schedule: (value: T) => Promise<void>;
};

export const createLatestIntentWriteLane = <T>(params: {
  beforeRun?: () => Promise<void>;
  run: (value: T) => Promise<void>;
  /**
   * Combines a still-pending job's value with a newly scheduled one. Defaults to
   * replacing the pending value outright (the pre-existing behavior). Callers whose
   * T represents independently-addressable items (e.g. a config-item map) should
   * supply a merge - e.g. `(previous, next) => ({...previous, ...next})` - so that
   * scheduling a write for one item while another item's write is still pending
   * combines both into a single run() instead of silently discarding the first.
   * Without this, resolveUpTo() still resolves the discarded job's waiter as a
   * success once the *replacing* job's run() succeeds, even though that item's
   * write was never sent. See HARD9-016.
   */
  merge?: (previous: T, next: T) => T;
}): LatestIntentWriteLane<T> => {
  const { beforeRun, run, merge } = params;

  let activePromise: Promise<void> | null = null;
  let latestJob: PendingJob<T> | null = null;
  let nextVersion = 0;
  let settledVersion = 0;
  const waiters = new Map<number, Waiter[]>();

  const resolveUpTo = (version: number) => {
    Array.from(waiters.keys())
      .filter((key) => key <= version)
      .forEach((key) => {
        waiters.get(key)?.forEach((waiter) => waiter.resolve());
        waiters.delete(key);
      });
  };

  const rejectUpTo = (version: number, error: Error) => {
    Array.from(waiters.keys())
      .filter((key) => key <= version)
      .forEach((key) => {
        waiters.get(key)?.forEach((waiter) => waiter.reject(error));
        waiters.delete(key);
      });
  };

  const process = () => {
    if (activePromise) return activePromise;
    activePromise = (async () => {
      while (latestJob) {
        const job: PendingJob<T> = latestJob;
        latestJob = null;
        try {
          if (beforeRun) {
            await beforeRun();
          }
          const nextLatest = latestJob as PendingJob<T> | null;
          if (nextLatest && nextLatest.version > job.version) {
            // job was taken out of latestJob (line 70) before beforeRun()
            // suspended, so a job scheduled while job was waiting there
            // never went through schedule()'s own merge - it only ever saw
            // an empty latestJob. Merge job's value into the superseding job
            // here instead, or job's write is silently dropped even though
            // resolveUpTo() below still resolves its waiter as a success.
            // See HARD9-016.
            if (merge) {
              latestJob = { version: nextLatest.version, value: merge(job.value, nextLatest.value) };
            }
            continue;
          }
          await run(job.value);
          settledVersion = Math.max(settledVersion, job.version);
          resolveUpTo(settledVersion);
        } catch (error) {
          if (latestJob) {
            if (merge) {
              latestJob = { version: latestJob.version, value: merge(job.value, latestJob.value) };
            }
            continue;
          }
          const err = error as Error;
          settledVersion = Math.max(settledVersion, job.version);
          // HARD12-010: in merge-semantics lanes every waiter ≤ job.version had
          // its value folded into this failed run, so all of them must reject
          // (the previous resolveUpTo(job.version - 1) silently resolved the
          // pre-merge waiters as success even though their values were part
          // of the failed batch). Replace-semantics lanes keep the historical
          // behaviour — superseded waiters never had their write attempted.
          if (merge) {
            rejectUpTo(job.version, err);
          } else {
            resolveUpTo(job.version - 1);
            rejectUpTo(job.version, err);
          }
        }
      }
    })().finally(() => {
      activePromise = null;
      if (latestJob) {
        void process();
      }
    });
    return activePromise;
  };

  return {
    schedule: (value) => {
      nextVersion += 1;
      const version = nextVersion;
      latestJob = {
        version,
        value: merge && latestJob ? merge(latestJob.value, value) : value,
      };
      return new Promise<void>((resolve, reject) => {
        const entries = waiters.get(version) ?? [];
        entries.push({ resolve, reject });
        waiters.set(version, entries);
        void process();
      });
    },
  };
};
