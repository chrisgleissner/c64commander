/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadConfigWriteIntervalMs } from './appSettings';
import { addErrorLog } from '@/lib/logging';

let lastWriteAt = 0;
let queue = Promise.resolve();

const waitForInterval = async () => {
  const minInterval = loadConfigWriteIntervalMs();
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
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastWriteAt = Date.now();
};

export const scheduleConfigWrite = async <T,>(task: () => Promise<T>): Promise<T> => {
  const run = async () => {
    await waitForInterval();
    return task();
  };
  const next = queue.then(run);
  queue = next.catch((error) => {
    addErrorLog('Config write queue: preceding task failed', { error: (error as Error).message });
  });
  return next;
};

export const resetConfigWriteThrottle = () => {
  lastWriteAt = 0;
  queue = Promise.resolve();
};
