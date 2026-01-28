import fs from 'node:fs';
import { sleep } from './utils.mjs';

export const waitForLogPattern = async (logPath, pattern, timeoutSeconds = 40) => {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    const content = await fs.promises.readFile(logPath, 'utf8').catch(() => '');
    if (pattern.test(content)) {
      return true;
    }
    await sleep(1000);
  }
  throw new Error(`Expected log pattern not found: ${pattern}`);
};

export const assertNoDemoState = (payload) => {
  if (payload && payload.includes('"state":"DEMO_ACTIVE"')) {
    throw new Error('Demo mode activated unexpectedly.');
  }
};
