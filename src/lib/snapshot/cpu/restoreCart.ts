/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isCiaTimerRegister } from "@/lib/machine/ciaTimerRegisters";
import { addErrorLog } from "@/lib/logging";
import type { CpuState } from "./cpuState";
import { assertValidCpuState } from "./cpuState";
import { buildCrt } from "./crt";
import {
  buildRestoreImage,
  CART_LOAD_ADDR,
  RESTORE_FLAG_ADDR,
  RESTORE_FLAG_GO,
  RESTORE_FLAG_READY,
  RESTORE_MIN_SAFE_SP,
  RESTORE_STUB_ADDR,
} from "./six502/restorePayload";

/**
 * CUR (Custom Upload-cartridge Restore) orchestration.
 *
 * This drives the exact handshake proven on the real c64u (firmware 1.1.0): a
 * per-snapshot 8 KiB CBM80 cartridge is uploaded with `run_crt`; its cold-start
 * spins on the `$02` flag; the app DMA-writes the snapshot RAM, plants the RTI
 * frame in the free stack, then releases the cart, which disables itself and
 * `RTI`s to the saved PC with the saved registers. See {@link buildRestoreImage}
 * and the `cpu-snapshot-restore-validated` memory for the mechanism.
 */

/** Minimal structural slice of the REST client this module needs (kept testable). */
export type RestoreCpuApi = {
  runCartridgeUpload: (
    crt: Blob,
    metadata?: { filename?: string },
    options?: Record<string, unknown>,
  ) => Promise<{ errors: string[] }>;
  readMemory: (address: string, length?: number, options?: Record<string, unknown>) => Promise<Uint8Array>;
  writeMemoryBlock: (
    address: string,
    data: Uint8Array,
    options?: Record<string, unknown>,
  ) => Promise<{ errors: string[] }>;
  /**
   * Used only as a best-effort recovery when a failure strikes after the
   * restore cartridge has already been uploaded (the C64 is reset into it
   * and frozen at that point regardless of what this restore attempt does
   * next) - never called for a pre-upload failure. See HARD9-036.
   */
  machineReset: () => Promise<{ errors: string[] }>;
};

export type CpuRestoreRange = {
  /** Inclusive start address (0x0000–0xFFFF). */
  start: number;
  bytes: Uint8Array;
};

export type CpuRestoreInput = {
  cpu: CpuState;
  /** Full snapshot RAM. Must include `$01` and the stack page `$0100-$01FF`. */
  ramRanges: CpuRestoreRange[];
};

export type RestoreCpuOptions = {
  /** Cartridge filename presented to `run_crt`. */
  filename?: string;
  /** Max time to wait for the cart to reach its spin loop. */
  readyTimeoutMs?: number;
  /** Poll interval while waiting for READY. */
  pollIntervalMs?: number;
  /** Injectable clock + sleep (for deterministic tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type RestoreCpuResult = {
  ok: true;
  /** Address (and 3 bytes) where the RTI frame was planted. */
  rtiFrameAddress: number;
};

/** Thrown when a snapshot cannot be CPU-restored (the caller should offer RAM-only restore). */
export class CpuRestoreUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CpuRestoreUnsupportedError";
  }
}

const WRITE_CHUNK_SIZE = 0x1000;
const DEFAULT_READY_TIMEOUT_MS = 8000;
const DEFAULT_POLL_INTERVAL_MS = 100;

const toHexAddress = (value: number) => value.toString(16).toUpperCase().padStart(4, "0");

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Chunk writes/poll-reads are retried: the fragile C64U firmware drops requests under burst load. */
const RETRY_ATTEMPTS = 4;

type Sleep = (ms: number) => Promise<void>;

/**
 * Writes a memory block, retrying on a thrown error or a returned error array.
 * A dropped writemem (the C64U returns 404/closes the socket under load) would
 * otherwise silently corrupt the restored RAM and resume a hung program.
 */
const writeWithRetry = async (api: RestoreCpuApi, addr: string, data: Uint8Array, sleep: Sleep): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await api.writeMemoryBlock(addr, data);
      if (!result || !Array.isArray(result.errors) || result.errors.length === 0) return;
      lastError = new Error(`writemem $${addr}: ${result.errors.join(", ")}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(120 * (attempt + 1));
  }
  throw lastError ?? new Error(`writemem $${addr} failed after ${RETRY_ATTEMPTS} attempts`);
};

/** Reads memory, retrying on a thrown error (transient 404s under load). */
const readWithRetry = async (api: RestoreCpuApi, addr: string, len: number, sleep: Sleep): Promise<Uint8Array> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await api.readMemory(addr, len);
    } catch (error) {
      lastError = error;
      await sleep(120 * (attempt + 1));
    }
  }
  throw lastError ?? new Error(`readmem $${addr} failed after ${RETRY_ATTEMPTS} attempts`);
};

/** Reads a single snapshot byte at `addr` from the supplied ranges, if covered. */
export const readByteFromRanges = (ranges: CpuRestoreRange[], addr: number): number | undefined => {
  for (const { start, bytes } of ranges) {
    if (addr >= start && addr < start + bytes.length) {
      return bytes[addr - start];
    }
  }
  return undefined;
};

/** True for addresses the restore must never overwrite during the bulk RAM write. */
const isSkippedAddress = (addr: number): boolean => addr === RESTORE_FLAG_ADDR || isCiaTimerRegister(addr);

/**
 * Writes one snapshot range, splitting around skipped addresses (CIA timer
 * registers + the `$02` handshake byte) and chunking large spans. Never pauses
 * the machine — the cart must keep spinning so it sees the eventual release.
 */
const writeRangeWithSkips = async (
  api: RestoreCpuApi,
  start: number,
  bytes: Uint8Array,
  sleep: Sleep,
): Promise<void> => {
  let offset = 0;
  while (offset < bytes.length) {
    if (isSkippedAddress(start + offset)) {
      offset += 1;
      continue;
    }
    let end = offset;
    while (end < bytes.length && !isSkippedAddress(start + end)) end += 1;
    for (let chunkStart = offset; chunkStart < end; chunkStart += WRITE_CHUNK_SIZE) {
      const chunkEnd = Math.min(end, chunkStart + WRITE_CHUNK_SIZE);
      await writeWithRetry(api, toHexAddress(start + chunkStart), bytes.subarray(chunkStart, chunkEnd), sleep);
    }
    offset = end;
  }
};

/**
 * Restores full CPU + RAM state by uploading a per-snapshot CBM80 cartridge and
 * running the spin/DMA/finalize handshake. Throws {@link CpuRestoreUnsupportedError}
 * when the snapshot cannot be CPU-restored (stack too deep, missing `$01`).
 */
export const restoreCpuSnapshot = async (
  api: RestoreCpuApi,
  input: CpuRestoreInput,
  options: RestoreCpuOptions = {},
): Promise<RestoreCpuResult> => {
  const { cpu, ramRanges } = input;
  assertValidCpuState(cpu);

  if (cpu.sp < RESTORE_MIN_SAFE_SP) {
    throw new CpuRestoreUnsupportedError(
      `stack pointer $${cpu.sp.toString(16)} is below the safe minimum $${RESTORE_MIN_SAFE_SP.toString(16)} ` +
        `(the finalize stub + RTI frame would not fit in the free stack)`,
    );
  }

  const mem01 = readByteFromRanges(ramRanges, 0x01);
  if (mem01 === undefined) {
    throw new CpuRestoreUnsupportedError("snapshot does not include $01 (banking), required for CPU restore");
  }
  const mem02 = readByteFromRanges(ramRanges, RESTORE_FLAG_ADDR) ?? 0x00;

  const image = buildRestoreImage(cpu, { mem01, mem02 });
  const crt = buildCrt({ name: "C64C CPU RESTORE", chips: [{ loadAddress: CART_LOAD_ADDR, data: image }] });

  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const readyTimeout = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const filename = options.filename ?? "c64c-cpu-restore.crt";

  // 1) Boot our cartridge (resets the C64 and autostarts via the CBM80 vector).
  const blob = new Blob([crt as BlobPart], { type: "application/octet-stream" });
  await api.runCartridgeUpload(blob, { filename });

  // From here on the C64 is definitely reset into our spin-loop cart - any
  // failure below leaves it frozen there with no way for the user to get it
  // back short of a manual power-cycle. Writing the $02 GO flag as a
  // "recovery" isn't safe in general (steps 3/4 not finishing means the RTI
  // frame the cart finalizes into may be incomplete or absent, so releasing
  // it can crash into garbage); a full machine reset is the one recovery
  // that's safe regardless of which step failed. Best-effort only - if the
  // reset itself fails there is nothing left to try here. See HARD9-036.
  try {
    // 2) Wait for the cold-start to reach its spin loop ($02 == READY).
    const deadline = now() + readyTimeout;
    let ready = false;
    for (;;) {
      const value = (await readWithRetry(api, toHexAddress(RESTORE_FLAG_ADDR), 1, sleep))[0];
      if (value === RESTORE_FLAG_READY) {
        ready = true;
        break;
      }
      if (now() >= deadline) break;
      await sleep(pollInterval);
    }
    if (!ready) {
      throw new Error("CPU restore: cartridge did not reach its handshake (READY flag never set)");
    }

    // 3) DMA the snapshot RAM (skipping $02 and the CIA timer registers).
    for (const { start, bytes } of ramRanges) {
      await writeRangeWithSkips(api, start, bytes, sleep);
    }

    // 4) Plant the RTI frame (P, PCL, PCH) in the free stack just below the saved SP.
    const rtiFrameAddress = RESTORE_STUB_ADDR + cpu.sp - 2;
    await writeWithRetry(
      api,
      toHexAddress(rtiFrameAddress),
      new Uint8Array([cpu.p & 0xff, cpu.pc & 0xff, (cpu.pc >> 8) & 0xff]),
      sleep,
    );

    // 5) Release: the cart copies the finalize stub to the free stack and resumes.
    await writeWithRetry(api, toHexAddress(RESTORE_FLAG_ADDR), new Uint8Array([RESTORE_FLAG_GO]), sleep);

    return { ok: true, rtiFrameAddress };
  } catch (error) {
    let recovery = "reset not attempted";
    try {
      await api.machineReset();
      recovery = "the machine was automatically reset";
    } catch (resetError) {
      addErrorLog("CPU restore recovery reset failed", {
        error: (resetError as Error).message,
      });
      recovery = "automatic reset also failed - power-cycle the machine manually";
    }
    const original = error as Error;
    const augmented = new Error(`${original.message} (${recovery})`);
    augmented.name = original.name;
    addErrorLog("CPU restore failed after cartridge upload", {
      error: original.message,
      recovery,
    });
    throw augmented;
  }
};
