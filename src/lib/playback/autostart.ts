/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { C64API } from "@/lib/c64api";

/**
 * Maximum number of bytes the C64 keyboard buffer ($0277) can hold at once.
 * Writing more than this overflows the firmware's input queue and corrupts the
 * preceding bytes (HARD12-008).
 */
export const KEYBOARD_BUFFER_MAX_BYTES = 10;

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

/**
 * Split a payload into ≤10-byte chunks at offset boundaries that keep printable
 * PETSCII characters intact (no chunk crosses the LOAD/RUN boundaries).
 */
export const chunkKeyboardPayload = (payload: Uint8Array): Uint8Array[] => {
  if (payload.length === 0) return [];
  if (payload.length <= KEYBOARD_BUFFER_MAX_BYTES) return [payload];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += KEYBOARD_BUFFER_MAX_BYTES) {
    chunks.push(payload.slice(offset, Math.min(offset + KEYBOARD_BUFFER_MAX_BYTES, payload.length)));
  }
  return chunks;
};

export const injectAutostart = async (
  api: C64API,
  payload: Uint8Array = AUTOSTART_SEQUENCE,
  options: AutostartOptions = {},
) => {
  const pollIntervalMs = options.pollIntervalMs ?? 120;
  const maxAttempts = options.maxAttempts ?? 20;

  const chunks = chunkKeyboardPayload(payload);

  for (const chunk of chunks) {
    let chunkWritten = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const length = await readKeyboardBufferLength(api);
      if (length === 0) {
        await writeKeyboardBuffer(api, chunk);
        chunkWritten = true;
        break;
      }
      await delay(pollIntervalMs);
    }
    if (!chunkWritten) {
      const error = new Error("Keyboard buffer remained busy while waiting to autostart.");
      addErrorLog("Autostart injection failed", { error: error.message });
      throw error;
    }
    // Allow the kernal a chance to drain the chunk before writing the next one.
    await delay(pollIntervalMs);
  }
};
