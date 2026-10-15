/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ProbeTimeoutOptions = {
  timeoutMs: number;
  timeoutMessage: (timeoutMs: number) => string;
  /**
   * Set for a probe that calls `onDispatch` when its request leaves the app's queues. Its timeout then starts at
   * that moment, so time spent waiting behind other requests is not reported as the device being slow. The
   * budget bounds the whole probe, waiting included.
   */
  queueBudgetMs?: number;
};

export const withProbeTimeout = async <T>(
  run: (onDispatch: () => void) => Promise<T>,
  { timeoutMs, timeoutMessage, queueBudgetMs }: ProbeTimeoutOptions,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectTimeout!: (error: Error) => void;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const arm = (ms: number, message: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => rejectTimeout(new Error(message)), ms);
  };
  let onDispatch = () => {};
  if (queueBudgetMs === undefined) {
    arm(timeoutMs, timeoutMessage(timeoutMs));
  } else {
    const deadlineMs = Date.now() + queueBudgetMs;
    arm(queueBudgetMs, `${timeoutMessage(queueBudgetMs)} before it could be sent`);
    onDispatch = () => {
      onDispatch = () => {};
      const dispatchedTimeoutMs = Math.max(1, Math.min(timeoutMs, deadlineMs - Date.now()));
      arm(dispatchedTimeoutMs, timeoutMessage(dispatchedTimeoutMs));
    };
  }
  try {
    return await Promise.race([run(() => onDispatch()), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
