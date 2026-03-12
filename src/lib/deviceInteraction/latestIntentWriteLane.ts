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
}): LatestIntentWriteLane<T> => {
  const { beforeRun, run } = params;

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
        const job = latestJob;
        latestJob = null;
        try {
          if (beforeRun) {
            await beforeRun();
          }
          if (latestJob && latestJob.version > job.version) {
            continue;
          }
          await run(job.value);
          settledVersion = Math.max(settledVersion, job.version);
          resolveUpTo(settledVersion);
        } catch (error) {
          if (latestJob) {
            continue;
          }
          const err = error as Error;
          settledVersion = Math.max(settledVersion, job.version);
          rejectUpTo(job.version, err);
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
        value,
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
