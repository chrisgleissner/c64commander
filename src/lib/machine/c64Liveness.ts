/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { createActionContext, getActiveAction } from "@/lib/tracing/actionTrace";
import { recordDeviceGuard } from "@/lib/tracing/traceSession";
import { addLog } from "@/lib/logging";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";

const DEFAULT_JIFFY_WAIT_MS = 50;
const DEFAULT_RASTER_ATTEMPTS = 3;
const DEFAULT_RASTER_DELAY_MS = 2;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isTransientReadMemoryFailure = (error: unknown) => {
  const name = (error as { name?: string } | undefined)?.name;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    name !== "AbortError" &&
    (isTransientConnectivityFailure(message) || /timed out|host unreachable|failed to fetch/i.test(message))
  );
};

const readMemoryWithTransientRetry = async (api: C64API, address: string, length: number) => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await api.readMemory(address, length);
    } catch (error) {
      lastError = error;
      if (!isTransientReadMemoryFailure(error) || attempt >= 2) {
        throw error;
      }
      addLog("warn", "Retrying transient liveness readMemory failure", {
        address,
        length,
        attempt,
        maxAttempts: 2,
        error: error instanceof Error ? error.message : String(error ?? "readMemory failed"),
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "readMemory failed"));
};

const toUint24 = (bytes: Uint8Array) => bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);

const assertByteLength = (bytes: Uint8Array, expected: number, label: string) => {
  if (bytes.length !== expected) {
    throw new Error(`${label} read returned ${bytes.length} byte(s); expected ${expected}.`);
  }
};

const readJiffyClock = async (api: C64API) => {
  const bytes = await readMemoryWithTransientRetry(api, "00A2", 3);
  assertByteLength(bytes, 3, "Jiffy clock");
  return toUint24(bytes);
};

const readRaster = async (api: C64API) => {
  const bytes = await readMemoryWithTransientRetry(api, "D012", 1);
  assertByteLength(bytes, 1, "Raster");
  return bytes[0];
};

const recordLivenessTrace = (payload: Record<string, unknown>) => {
  const action = getActiveAction() ?? createActionContext("device.liveness", "system", null);
  recordDeviceGuard(action, payload);
};

export type C64LivenessDecision = "healthy" | "irq-stalled" | "wedged";

export type C64LivenessSample = {
  jiffyStart: number;
  jiffyEnd: number;
  jiffyAdvanced: boolean;
  rasterStart: number;
  rasterEnd: number;
  rasterChanged: boolean;
  decision: C64LivenessDecision;
};

export const checkC64Liveness = async (
  api: C64API,
  options: {
    jiffyWaitMs?: number;
    rasterAttempts?: number;
    rasterDelayMs?: number;
  } = {},
): Promise<C64LivenessSample> => {
  const jiffyWaitMs = options.jiffyWaitMs ?? DEFAULT_JIFFY_WAIT_MS;
  const rasterAttempts = Math.max(1, options.rasterAttempts ?? DEFAULT_RASTER_ATTEMPTS);
  const rasterDelayMs = Math.max(0, options.rasterDelayMs ?? DEFAULT_RASTER_DELAY_MS);

  try {
    const jiffyStart = await readJiffyClock(api);
    const rasterStart = await readRaster(api);

    await delay(jiffyWaitMs);

    const jiffyEnd = await readJiffyClock(api);
    let rasterEnd = rasterStart;
    let rasterChanged = false;

    for (let attempt = 0; attempt < rasterAttempts; attempt += 1) {
      await delay(rasterDelayMs);
      const next = await readRaster(api);
      rasterEnd = next;
      if (next !== rasterStart) {
        rasterChanged = true;
        break;
      }
    }

    const jiffyAdvanced = jiffyEnd !== jiffyStart;
    const decision: C64LivenessDecision = jiffyAdvanced ? "healthy" : rasterChanged ? "irq-stalled" : "wedged";

    recordLivenessTrace({
      decision,
      jiffyStart,
      jiffyEnd,
      jiffyAdvanced,
      rasterStart,
      rasterEnd,
      rasterChanged,
      jiffyWaitMs,
      rasterAttempts,
      rasterDelayMs,
    });

    return {
      jiffyStart,
      jiffyEnd,
      jiffyAdvanced,
      rasterStart,
      rasterEnd,
      rasterChanged,
      decision,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Liveness check failed");
    recordLivenessTrace({
      decision: "wedged",
      error: err.message,
      jiffyWaitMs,
      rasterAttempts,
      rasterDelayMs,
    });
    throw err;
  }
};
