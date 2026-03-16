/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { C64API } from "@/lib/c64api";

export const buildAutostartSequence = (busId = 8) => {
  const normalizedBusId = Number.isFinite(busId) && busId >= 0 ? Math.trunc(busId) : 8;
  const command = `LOAD"*",${normalizedBusId},1\rRUN\r`;
  return new Uint8Array(Array.from(command).map((char) => char.charCodeAt(0)));
};

export const AUTOSTART_SEQUENCE = buildAutostartSequence();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AutostartOptions = {
  pollIntervalMs?: number;
  maxAttempts?: number;
};

const readKeyboardBufferLength = async (api: C64API) => {
  const data = await api.readMemory("00C6", 1);
  return data[0] ?? 0;
};

const writeKeyboardBuffer = async (api: C64API, payload: Uint8Array) => {
  await api.writeMemory("0277", payload);
  await api.writeMemory("00C6", new Uint8Array([payload.length]));
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

  const error = new Error("Keyboard buffer remained busy while waiting to autostart.");
  addErrorLog("Autostart injection failed", { error: error.message });
  throw error;
};
