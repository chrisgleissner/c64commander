/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { injectAutostart } from "@/lib/playback/autostart";

let queue: Promise<void> = Promise.resolve();
let pendingCount = 0;

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
 */
export const enqueueKernalFallbackInjection = (
  api: C64API,
  payload: Uint8Array,
  options: { dropIfBusy?: boolean } = {},
): Promise<void> => {
  if (options.dropIfBusy && pendingCount > 1) return Promise.resolve();
  pendingCount += 1;
  const scheduled = queue.then(() => injectAutostart(api, payload));
  queue = scheduled.catch(() => undefined);
  return scheduled.finally(() => {
    pendingCount -= 1;
  });
};

export const resetKernalFallbackInjectionQueueForTests = () => {
  queue = Promise.resolve();
  pendingCount = 0;
};
