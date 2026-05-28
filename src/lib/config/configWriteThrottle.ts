/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadConfigWriteIntervalMs } from "./appSettings";
import { loadDeviceSafetyConfig } from "./deviceSafetySettings";
import { addErrorLog, addLog } from "@/lib/logging";

let lastWriteAt = 0;
let queue = Promise.resolve();
let resetGeneration = 0;
let lastResetReason = "reset";
const resetListeners = new Set<(reason: string) => void>();

export class ConfigWriteCancelledError extends Error {
  readonly isCancellation = true as const;

  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "ConfigWriteCancelledError";
  }
}

const buildCancellationError = (reason: string) =>
  new ConfigWriteCancelledError(`Config write queued task cancelled: ${reason}`, reason);

const assertNotReset = (generation: number) => {
  if (generation !== resetGeneration) {
    throw buildCancellationError(lastResetReason);
  }
};

const waitForResettableDelay = (waitMs: number, generation: number) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resetListeners.delete(cancel);
      callback();
    };
    const cancel = (reason: string) => {
      if (generation !== resetGeneration) {
        finish(() => reject(buildCancellationError(reason)));
      }
    };
    const timer = setTimeout(() => {
      finish(resolve);
    }, waitMs);
    resetListeners.add(cancel);
  });

const isConfigWriteCancelled = (error: unknown) =>
  error instanceof ConfigWriteCancelledError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { name?: string; isCancellation?: boolean }).name === "ConfigWriteCancelledError" &&
    (error as { isCancellation?: boolean }).isCancellation === true);

const waitForInterval = async (generation: number) => {
  const appIntervalMs = loadConfigWriteIntervalMs();
  const safety = loadDeviceSafetyConfig();
  const minInterval = Math.max(appIntervalMs, safety.configsCooldownMs);
  if (minInterval <= 0) {
    assertNotReset(generation);
    lastWriteAt = Date.now();
    return;
  }
  if (lastWriteAt === 0) {
    assertNotReset(generation);
    lastWriteAt = Date.now();
    return;
  }
  const now = Date.now();
  const elapsed = now - lastWriteAt;
  const waitMs = Math.max(0, minInterval - elapsed);
  if (waitMs > 0) {
    addLog("debug", "Config write backoff delay applied", {
      waitMs,
      appIntervalMs,
      deviceSafetyConfigsCooldownMs: safety.configsCooldownMs,
      deviceSafetyMode: safety.mode,
      effectiveDeviceSafetyMode: safety.resolution?.effectiveMode ?? safety.mode,
    });
    await waitForResettableDelay(waitMs, generation);
  }
  assertNotReset(generation);
  lastWriteAt = Date.now();
};

export const scheduleConfigWrite = async <T>(task: () => Promise<T>): Promise<T> => {
  const generation = resetGeneration;
  const run = async () => {
    assertNotReset(generation);
    await waitForInterval(generation);
    assertNotReset(generation);
    addLog("debug", "Config write queue task starting", {
      deviceSafetyConfigsCooldownMs: loadDeviceSafetyConfig().configsCooldownMs,
    });
    return task();
  };
  const next = queue.then(run);
  queue = next.then(
    () => undefined,
    (error) => {
      if (isConfigWriteCancelled(error)) {
        addLog("debug", "Config write queue task cancelled", {
          reason: (error as ConfigWriteCancelledError).reason,
        });
        return;
      }
      addErrorLog("Config write queue: preceding task failed", {
        error: (error as Error).message,
      });
    },
  );
  return next;
};

export const resetConfigWriteThrottle = (reason = "reset") => {
  resetGeneration += 1;
  lastResetReason = reason;
  lastWriteAt = 0;
  queue = Promise.resolve();
  resetListeners.forEach((listener) => listener(reason));
};
