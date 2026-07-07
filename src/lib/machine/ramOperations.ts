/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { addErrorLog, addLog } from "@/lib/logging";
import { checkC64Liveness } from "@/lib/machine/c64Liveness";
import { createActionContext, getActiveAction } from "@/lib/tracing/actionTrace";
import { recordDeviceGuard } from "@/lib/tracing/traceSession";

export const FULL_RAM_SIZE_BYTES = 0x10000;
const IO_REGION_START = 0xd000;
const IO_REGION_END = 0xe000;
const READ_CHUNK_SIZE_BYTES = 0x1000;
// 4 KiB write chunks are kept for selective memory clearing operations.
const WRITE_CHUNK_SIZE_BYTES = 0x1000;
const WAIT_BETWEEN_RETRIES_MS = 120;
const DEFAULT_RETRY_ATTEMPTS = 2;
// The CIA-timer-register skip lives in its own dependency-free module so the
// CPU-snapshot restore path can share it without importing the REST client.
// (See ciaTimerRegisters.ts for the full rationale — the cursor-blink hazard.)
export { isCiaTimerRegister } from "@/lib/machine/ciaTimerRegisters";
import { isCiaTimerRegister } from "@/lib/machine/ciaTimerRegisters";

type RamRange = {
  start: number;
  endExclusive: number;
};

const CLEAR_RAM_RANGES: RamRange[] = [
  { start: 0x0000, endExclusive: IO_REGION_START },
  { start: IO_REGION_END, endExclusive: FULL_RAM_SIZE_BYTES },
];

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const toHexAddress = (value: number) => value.toString(16).toUpperCase().padStart(4, "0");

const asError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error) return error;
  return new Error(fallbackMessage);
};

const withRetry = async <T>(
  operation: string,
  run: () => Promise<T>,
  attempts = DEFAULT_RETRY_ATTEMPTS,
  onRetry?: (error: Error, attempt: number, maxAttempts: number) => Promise<void>,
): Promise<T> => {
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt < attempts) {
    attempt += 1;
    try {
      return await run();
    } catch (error) {
      lastError = asError(error, `${operation} failed`);
      if (attempt >= attempts) break;
      if (onRetry) {
        await onRetry(lastError, attempt, attempts);
      }
      addErrorLog("RAM operation retry", {
        operation,
        attempt,
        attempts,
        error: lastError.message,
      });
      await delay(WAIT_BETWEEN_RETRIES_MS);
    }
  }
  const message = lastError?.message ?? `${operation} failed`;
  throw new Error(`${operation} failed after ${attempts} attempt(s): ${message}`);
};

const recordRamTrace = (payload: Record<string, unknown>) => {
  const action = getActiveAction() ?? createActionContext("ram.operation", "system", null);
  recordDeviceGuard(action, payload);
};

const ensureLiveness = async (api: C64API, operation: string) => {
  const sample = await checkC64Liveness(api);
  if (sample.decision === "wedged") {
    throw new Error(`${operation} aborted: C64 appears wedged.`);
  }
  recordRamTrace({
    operation,
    status: "liveness-ok",
    decision: sample.decision,
  });
  return sample;
};

const recoverFromLivenessFailure = async (api: C64API, operation: string) => {
  let sample: Awaited<ReturnType<typeof checkC64Liveness>> | null = null;
  try {
    sample = await checkC64Liveness(api);
  } catch (error) {
    const err = asError(error, "Liveness check failed");
    recordRamTrace({ operation, status: "liveness-error", error: err.message });
    throw err;
  }

  if (sample.decision !== "wedged") {
    recordRamTrace({
      operation,
      status: "liveness-ok",
      decision: sample.decision,
    });
    return;
  }

  recordRamTrace({
    operation,
    status: "liveness-wedged",
    decision: sample.decision,
  });
  await withRetry("Reset machine after liveness failure", () => api.machineReset());
  await delay(500);
  const afterReset = await checkC64Liveness(api);
  if (afterReset.decision !== "wedged") {
    recordRamTrace({
      operation,
      status: "liveness-recovered",
      decision: afterReset.decision,
    });
    return;
  }

  recordRamTrace({
    operation,
    status: "liveness-reset-failed",
    decision: afterReset.decision,
  });
  await withRetry("Reboot machine after liveness failure", () => api.machineReboot());
  await delay(800);
  const afterReboot = await checkC64Liveness(api);
  if (afterReboot.decision === "wedged") {
    recordRamTrace({
      operation,
      status: "liveness-reboot-failed",
      decision: afterReboot.decision,
    });
    throw new Error(`${operation} aborted: C64 remained wedged after reboot.`);
  }
  recordRamTrace({
    operation,
    status: "liveness-recovered",
    decision: afterReboot.decision,
  });
};

const readRangeBlock = async (
  api: C64API,
  start: number,
  length: number,
  onRetry?: (error: Error, attempt: number, maxAttempts: number) => Promise<void>,
): Promise<Uint8Array> => {
  const block = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += READ_CHUNK_SIZE_BYTES) {
    const chunkSize = Math.min(READ_CHUNK_SIZE_BYTES, length - offset);
    const address = toHexAddress(start + offset);
    recordRamTrace({ operation: "ram-read", status: "start", address, expectedLength: chunkSize });
    const chunk = await withRetry(
      `Read RAM chunk at $${address}`,
      () => api.readMemory(address, chunkSize),
      DEFAULT_RETRY_ATTEMPTS,
      onRetry,
    );
    if (chunk.length !== chunkSize) {
      recordRamTrace({
        operation: "ram-read",
        status: "error",
        address,
        expectedLength: chunkSize,
        actualLength: chunk.length,
      });
      throw new Error(`Unexpected RAM chunk length at $${address}: expected ${chunkSize}, got ${chunk.length}`);
    }
    recordRamTrace({
      operation: "ram-read",
      status: "success",
      address,
      expectedLength: chunkSize,
      actualLength: chunk.length,
    });
    block.set(chunk, offset);
  }
  return block;
};

const writeRanges = async (
  api: C64API,
  image: Uint8Array,
  ranges: RamRange[],
  onRetry?: (error: Error, attempt: number, maxAttempts: number) => Promise<void>,
) => {
  for (const range of ranges) {
    for (let address = range.start; address < range.endExclusive; address += WRITE_CHUNK_SIZE_BYTES) {
      const chunkSize = Math.min(WRITE_CHUNK_SIZE_BYTES, range.endExclusive - address);
      const chunk = image.subarray(address, address + chunkSize);
      recordRamTrace({
        operation: "ram-write",
        status: "start",
        address: toHexAddress(address),
        expectedLength: chunkSize,
      });
      await withRetry(
        `Write RAM chunk at $${toHexAddress(address)}`,
        () => api.writeMemoryBlock(toHexAddress(address), chunk),
        DEFAULT_RETRY_ATTEMPTS,
        onRetry ?? (async () => recoverFromLivenessFailure(api, "Load RAM")),
      );
      recordRamTrace({
        operation: "ram-write",
        status: "success",
        address: toHexAddress(address),
        expectedLength: chunkSize,
        actualLength: chunkSize,
      });
    }
  }
};

const runPaused = async <T>(
  api: C64API,
  operation: string,
  run: () => Promise<T>,
  options?: { alreadyPaused?: boolean },
): Promise<T> => {
  // HARD18-015: when the machine was already paused by the user before this
  // operation started, never pause/resume around it - a snapshot save/restore
  // must not silently undo a deliberate pause.
  const alreadyPaused = options?.alreadyPaused ?? false;
  let paused = false;
  let operationError: Error | null = null;
  let resumeFailure: Error | null = null;
  let result: T | undefined;
  try {
    if (!alreadyPaused) {
      await withRetry("Pause machine", () => api.machinePause());
      paused = true;
    }
    result = await run();
    if (!alreadyPaused) {
      await withRetry("Resume machine", () => api.machineResume());
      paused = false;
    }
  } catch (error) {
    operationError = asError(error, `${operation} failed`);
  } finally {
    if (paused) {
      try {
        await withRetry("Resume machine after failure", () => api.machineResume());
      } catch (error) {
        const resumeErr = asError(error, "Resume machine failed");
        resumeFailure = resumeErr;
        addErrorLog("Failed to resume machine after RAM operation error", {
          operation,
          error: resumeErr.message,
        });
      }
    }
  }

  if (operationError && resumeFailure) {
    throw new Error(`${operation} failed: ${operationError.message}; resume failed: ${resumeFailure.message}`);
  }
  if (operationError) {
    throw new Error(`${operation} failed: ${operationError.message}`);
  }
  if (resumeFailure) {
    throw new Error(`${operation} failed while resuming: ${resumeFailure.message}`);
  }
  return result as T;
};

export type MemoryRangeSpec = { start: number; length: number };

/**
 * Reads a specific set of memory ranges from the machine (paused) and returns
 * the bytes for each. Only the requested bytes are transferred, so a snapshot
 * that needs a handful of ranges no longer pays for a full 64 KiB dump.
 *
 * `resolve` may itself read from the machine before deciding which ranges to
 * capture (e.g. a screen snapshot inspects the live CIA2 VIC-bank register); it
 * runs inside the same paused session so the resolved ranges and their contents
 * stay consistent.
 */
export const dumpRamRanges = async (
  api: C64API,
  resolve:
    | MemoryRangeSpec[]
    | ((read: (address: number, length: number) => Promise<Uint8Array>) => Promise<MemoryRangeSpec[]>),
  options?: { recoveryMode?: boolean; alreadyPaused?: boolean },
): Promise<{ ranges: MemoryRangeSpec[]; blocks: Uint8Array[] }> => {
  await ensureLiveness(api, "Save RAM");
  const onRetry = options?.recoveryMode ? async () => recoverFromLivenessFailure(api, "Save RAM") : undefined;
  return runPaused(
    api,
    "Save RAM",
    async () => {
      const read = (address: number, length: number) =>
        withRetry(
          `Read RAM at $${toHexAddress(address)}`,
          () => api.readMemory(toHexAddress(address), length),
          DEFAULT_RETRY_ATTEMPTS,
          onRetry,
        );
      const ranges = typeof resolve === "function" ? await resolve(read) : resolve;
      const blocks: Uint8Array[] = [];
      for (const range of ranges) {
        if (range.start < 0 || range.length < 0 || range.start + range.length > FULL_RAM_SIZE_BYTES) {
          throw new Error(`dumpRamRanges: range out of bounds: start=${range.start}, length=${range.length}`);
        }
        blocks.push(await readRangeBlock(api, range.start, range.length, onRetry));
      }
      return { ranges, blocks };
    },
    { alreadyPaused: options?.alreadyPaused },
  );
};

export const clearRamAndReboot = async (api: C64API) => {
  let paused = false;
  let rebooted = false;
  let operationError: Error | null = null;
  let resumeFailure: Error | null = null;
  const zeroBlock = new Uint8Array(FULL_RAM_SIZE_BYTES);

  try {
    await withRetry("Pause machine", () => api.machinePause());
    paused = true;
    await writeRanges(api, zeroBlock, CLEAR_RAM_RANGES);
    await withRetry("Reboot machine", () => api.machineReboot());
    await delay(800);
    await ensureLiveness(api, "Reboot (Clr Mem)");
    rebooted = true;
    paused = false;
  } catch (error) {
    operationError = asError(error, "Reboot (Clr Mem) failed");
  } finally {
    if (paused && !rebooted) {
      try {
        await withRetry("Resume machine after clear-memory failure", () => api.machineResume());
      } catch (error) {
        const resumeErr = asError(error, "Resume machine failed");
        resumeFailure = resumeErr;
        addErrorLog("Failed to resume machine after clear-memory error", {
          error: resumeErr.message,
        });
      }
    }
  }

  if (operationError && resumeFailure) {
    throw new Error(`Reboot (Clr Mem) failed: ${operationError.message}; resume failed: ${resumeFailure.message}`);
  }
  if (operationError) {
    throw new Error(`Reboot (Clr Mem) failed: ${operationError.message}`);
  }
  if (resumeFailure) {
    throw new Error(`Reboot (Clr Mem) failed while resuming: ${resumeFailure.message}`);
  }
};

/**
 * Writes a single snapshot range to C64 memory, splitting it around the CIA
 * timer registers so those are never overwritten. Each writable sub-range is
 * written directly in chunks.
 */
const writeSnapshotRange = async (
  api: C64API,
  start: number,
  bytes: Uint8Array,
  onRetry: (error: Error, attempt: number, maxAttempts: number) => Promise<void>,
) => {
  let offset = 0;
  while (offset < bytes.length) {
    if (isCiaTimerRegister(start + offset)) {
      offset += 1;
      continue;
    }
    let end = offset;
    while (end < bytes.length && !isCiaTimerRegister(start + end)) {
      end += 1;
    }
    for (let chunkStart = offset; chunkStart < end; chunkStart += WRITE_CHUNK_SIZE_BYTES) {
      const chunkEnd = Math.min(end, chunkStart + WRITE_CHUNK_SIZE_BYTES);
      const address = toHexAddress(start + chunkStart);
      const chunk = bytes.subarray(chunkStart, chunkEnd);
      recordRamTrace({ operation: "ram-write", status: "start", address, expectedLength: chunk.length });
      await withRetry(
        `Write RAM snapshot chunk at $${address}`,
        () => api.writeMemoryBlock(address, chunk),
        DEFAULT_RETRY_ATTEMPTS,
        onRetry,
      );
      recordRamTrace({
        operation: "ram-write",
        status: "success",
        address,
        expectedLength: chunk.length,
        actualLength: chunk.length,
      });
    }
    offset = end;
  }
};

/**
 * Writes a set of (address, bytes) pairs to C64 memory.
 * Used for restoring typed RAM snapshots from the snapshot store.
 *
 * Only the snapshot's own bytes are written; memory outside the snapshot keeps
 * its live value by simply not being touched. Crucially we do NOT read and
 * write back the full $0000-$FFFF image: that round-tripped the live I/O region
 * and corrupted the CIA1 jiffy timer, making the cursor blink faster on every
 * consecutive restore. Volatile CIA timer/interrupt registers are skipped even
 * when a snapshot range happens to cover them.
 */
export const loadMemoryRanges = async (
  api: C64API,
  ranges: Array<{ start: number; bytes: Uint8Array }>,
  options?: { alreadyPaused?: boolean },
) => {
  if (ranges.length === 0) {
    throw new Error("loadMemoryRanges: no ranges provided");
  }
  for (const { start, bytes } of ranges) {
    if (start < 0 || start >= FULL_RAM_SIZE_BYTES) {
      throw new Error(`loadMemoryRanges: range start out of bounds: ${start}`);
    }
    if (start + bytes.length > FULL_RAM_SIZE_BYTES) {
      throw new Error(`loadMemoryRanges: range end out of bounds: start=${start}, length=${bytes.length}`);
    }
  }
  await ensureLiveness(api, "Load RAM Snapshot");
  const onRetry = async () => recoverFromLivenessFailure(api, "Load RAM Snapshot");
  await runPaused(
    api,
    "Load RAM Snapshot",
    async () => {
      for (const { start, bytes } of ranges) {
        await writeSnapshotRange(api, start, bytes, onRetry);
      }
    },
    { alreadyPaused: options?.alreadyPaused },
  );
};
