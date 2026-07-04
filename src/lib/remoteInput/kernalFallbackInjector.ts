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
 */
export const enqueueKernalFallbackInjection = (api: C64API, payload: Uint8Array): Promise<void> => {
  const scheduled = queue.then(() => injectAutostart(api, payload));
  queue = scheduled.catch(() => undefined);
  return scheduled;
};

export const resetKernalFallbackInjectionQueueForTests = () => {
  queue = Promise.resolve();
};
