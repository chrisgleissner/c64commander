import { loadConfigWriteIntervalMs } from './appSettings';

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
  queue = next.catch(() => {});
  return next;
};

export const resetConfigWriteThrottle = () => {
  lastWriteAt = 0;
  queue = Promise.resolve();
};
