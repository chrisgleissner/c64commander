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

const waitForInterval = async () => {
  const appIntervalMs = loadConfigWriteIntervalMs();
  const safety = loadDeviceSafetyConfig();
  const minInterval = Math.max(appIntervalMs, safety.configsCooldownMs);
  if (minInterval <= 0) {
    lastWriteAt = Date.now();
    return;
  }
  if (lastWriteAt === 0) {
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
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastWriteAt = Date.now();
};

export const scheduleConfigWrite = async <T>(task: () => Promise<T>): Promise<T> => {
  const run = async () => {
    await waitForInterval();
    addLog("debug", "Config write queue task starting", {
      deviceSafetyConfigsCooldownMs: loadDeviceSafetyConfig().configsCooldownMs,
    });
    return task();
  };
  const next = queue.then(run);
  queue = next.then(
    () => undefined,
    (error) => {
      addErrorLog("Config write queue: preceding task failed", {
        error: (error as Error).message,
      });
    },
  );
  return next;
};

export const resetConfigWriteThrottle = () => {
  lastWriteAt = 0;
  queue = Promise.resolve();
};
