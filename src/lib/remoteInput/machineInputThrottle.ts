/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";

let lastSentAtMs: number | null = null;
let queue: Promise<void> = Promise.resolve();

const runThrottled = async (): Promise<void> => {
  const cooldownMs = loadDeviceSafetyConfig().machineInputCooldownMs;
  const now = Date.now();
  if (cooldownMs <= 0 || lastSentAtMs === null) {
    lastSentAtMs = now;
    return;
  }
  const elapsed = now - lastSentAtMs;
  const waitMs = cooldownMs - elapsed;
  if (waitMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  }
  lastSentAtMs = Date.now();
};

/**
 * HARD12-017 device-safeguard entry: enforces the user-configured minimum
 * interval between consecutive `POST /v1/machine:input` sends (Settings →
 * device safety → "Machine input cooldown"). Calls are serialized through a
 * FIFO queue — without this, two nearly-simultaneous callers can both read
 * the same stale `lastSentAtMs` before either updates it and both slip
 * through with zero gap between the actual sends, defeating the rate limit
 * (found via chaos testing). Unlike `configWriteThrottle`, there is no
 * cancellation model: the transport's own coalescing already collapses
 * bursts, so this is purely a floor on how often an actual network call may
 * fire. A RELAXED-mode cooldown of 0ms resolves instantly ("as many as the
 * user can press").
 */
export const waitForMachineInputThrottle = (): Promise<void> => {
  const next = queue.then(runThrottled);
  queue = next;
  return next;
};

export const resetMachineInputThrottleForTests = () => {
  lastSentAtMs = null;
  queue = Promise.resolve();
};
