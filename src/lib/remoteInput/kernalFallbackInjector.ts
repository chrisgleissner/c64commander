/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { injectAutostart } from "@/lib/playback/autostart";

let queue: Promise<void> = Promise.resolve();
let pendingCount = 0;
// HARD19-017: bumped whenever the queue is drained (e.g. a device retarget).
// Each injection captures the epoch at enqueue and skips if it has since changed.
let injectionEpoch = 0;

/**
 * HARD15-001: serializes every kernal-fallback keyboard-buffer injection
 * through one FIFO queue (mirrors `machineInputThrottle.ts`'s
 * `queue = queue.then(run)` pattern). `injectAutostart` is an async
 * poll-then-write loop against the shared C64 keyboard buffer
 * ($0277/$00C6, see `src/lib/playback/autostart.ts`); running two of these
 * loops concurrently races on that buffer - dropping or garbling keystrokes -
 * and doubles the poll traffic hitting the load-fragile c64u. A rejected
 * injection only settles its own caller's promise: `queue` itself is always
 * replaced with a resolved continuation, so one failure can never stall or
 * poison injections queued after it.
 *
 * HARD16-003: each injection costs ~0.6 s serially on the c64u's CONSERVATIVE
 * profile, but a held cursor key repeats at 10/s. `dropIfBusy` lets a lossy
 * producer (cursor hold-repeat) skip enqueueing once one injection is in
 * flight and one is already queued behind it (`pendingCount > 1`) — bounding
 * the queue to two so the cursor stops moving ~one injection after release
 * instead of draining a multi-second backlog and sustaining wedge-class REST
 * load. Typed characters never pass `dropIfBusy` and are never dropped.
 *
 * HARD19-018: exported under the neutral name `enqueueKeyboardBufferInjection`
 * because playback autostart (`injectDiskAutostart`, `loadFirstDiskPrgViaDma`)
 * now routes through the SAME queue — otherwise a playlist launch's
 * `injectAutostart` loop races a remote-input keystroke on $0277/$00C6.
 */
export const enqueueKeyboardBufferInjection = (
  api: C64API,
  payload: Uint8Array,
  options: { dropIfBusy?: boolean; pollIntervalMs?: number; maxAttempts?: number } = {},
): Promise<void> => {
  if (options.dropIfBusy && pendingCount > 1) return Promise.resolve();
  pendingCount += 1;
  // HARD19-017: capture the device this injection was enqueued for. The API is a
  // shared singleton whose getBaseUrl() resolves per request, so a saved-device
  // switch mid-queue would otherwise drain the remaining polls/writes onto the
  // NEW device's keyboard buffer. Skip (pre-run) if the device changed or the
  // queue was drained, and abort (mid-run) via injectAutostart's shouldAbort.
  const enqueuedHost = api.getDeviceHost();
  const enqueuedEpoch = injectionEpoch;
  const isStillValid = () => enqueuedEpoch === injectionEpoch && api.getDeviceHost() === enqueuedHost;
  const scheduled = queue.then(() => {
    if (!isStillValid()) {
      addLog("warn", "Skipping kernal-fallback injection: device changed or queue drained since enqueue", {
        enqueuedHost,
        currentHost: api.getDeviceHost(),
        drained: enqueuedEpoch !== injectionEpoch,
      });
      return;
    }
    return injectAutostart(api, payload, {
      pollIntervalMs: options.pollIntervalMs,
      maxAttempts: options.maxAttempts,
      shouldAbort: () => !isStillValid(),
    });
  });
  queue = scheduled.catch(() => undefined);
  return scheduled.finally(() => {
    pendingCount -= 1;
  });
};

/**
 * HARD19-017: cancel every queued/in-flight kernal-fallback injection. Called from
 * `prepareForDeviceRetarget` so a device switch cannot drain pending PETSCII onto
 * the new device. Bumping the epoch makes queued injections skip at run time and
 * in-flight injections abort at their next REST step; the queue tail settles on
 * its own (each injection's finally decrements pendingCount).
 */
export const drainKernalFallbackInjectionQueue = (): void => {
  injectionEpoch += 1;
};

export const resetKernalFallbackInjectionQueueForTests = () => {
  queue = Promise.resolve();
  pendingCount = 0;
  injectionEpoch += 1;
};
