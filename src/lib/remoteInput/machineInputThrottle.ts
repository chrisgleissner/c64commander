/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";

let lastCompletedAtMs: number | null = null;
let queue: Promise<void> = Promise.resolve();

/**
 * HARD12-017 device-safeguard entry for `POST /v1/machine:input` (the remote
 * joystick/keyboard relay). Dispatches are serialized through a FIFO queue whose
 * unit of work is the ENTIRE dispatch — the actual network call and its response,
 * not just a gate check. This guarantees the app never has two machine:input
 * calls in flight at once (the Ultimate firmware runs a single-threaded network
 * task; overlapping requests are exactly the concurrency it is fragile to), while
 * adding ZERO artificial delay: with the default 0ms cooldown the only spacing
 * between consecutive calls is the real ~15ms end-to-end round-trip of a single
 * call. Non-overlap is the correct — and sufficient — safety model for this
 * high-frequency endpoint; a fixed cooldown is intentionally NOT the mechanism.
 *
 * The optional `machineInputCooldownMs` (Settings → device safety) is an extra
 * floor measured from the PREVIOUS dispatch's completion, for anyone who wants
 * more spacing than non-overlap alone; it defaults to 0 in every safety mode.
 *
 * Never retries: `dispatch` owns its own error handling, and a rejected dispatch
 * still keeps the queue healthy so one failed call cannot wedge the chain.
 */
export const runSerializedMachineInput = (dispatch: () => Promise<unknown> | unknown): Promise<void> => {
  const run = async () => {
    const cooldownMs = loadDeviceSafetyConfig().machineInputCooldownMs;
    if (cooldownMs > 0 && lastCompletedAtMs !== null) {
      const waitMs = cooldownMs - (Date.now() - lastCompletedAtMs);
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    try {
      await dispatch();
    } finally {
      lastCompletedAtMs = Date.now();
    }
  };
  const next = queue.then(run);
  queue = next.catch(() => {});
  return next;
};

export const resetMachineInputThrottleForTests = () => {
  lastCompletedAtMs = null;
  queue = Promise.resolve();
};
