import { addErrorLog } from '@/lib/logging';
import type { C64API } from '@/lib/c64api';

// LOAD"*",8,1\rRUN\r
export const AUTOSTART_SEQUENCE = new Uint8Array([
  0x4c, 0x4f, 0x41, 0x44, 0x22, 0x2a, 0x22, 0x2c, 0x38, 0x2c, 0x31, 0x0d, 0x52, 0x55, 0x4e,
  0x0d,
]);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AutostartOptions = {
  pollIntervalMs?: number;
  maxAttempts?: number;
};

const readKeyboardBufferLength = async (api: C64API) => {
  const data = await api.readMemory('00C6', 1);
  return data[0] ?? 0;
};

const writeKeyboardBuffer = async (api: C64API, payload: Uint8Array) => {
  await api.writeMemory('0277', payload);
  await api.writeMemory('00C6', new Uint8Array([payload.length]));
};

export const injectAutostart = async (
  api: C64API,
  payload: Uint8Array = AUTOSTART_SEQUENCE,
  options: AutostartOptions = {},
) => {
  const pollIntervalMs = options.pollIntervalMs ?? 120;
  const maxAttempts = options.maxAttempts ?? 20;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const length = await readKeyboardBufferLength(api);
    if (length === 0) {
      await writeKeyboardBuffer(api, payload);
      return;
    }
    await delay(pollIntervalMs);
  }

  const error = new Error('Keyboard buffer remained busy while waiting to autostart.');
  addErrorLog('Autostart injection failed', { error: error.message });
  throw error;
};
