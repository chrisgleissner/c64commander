/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { CpuState } from "./cpuState";
import { assertValidCpuState } from "./cpuState";
import {
  buildCaptureHandler,
  DEFAULT_SAFE_REGION,
  type CaptureLayout,
} from "./six502/capturePayload";

/**
 * RLI (Ride the Live Interrupt) capture orchestration.
 *
 * The app pauses the machine, installs {@link buildCaptureHandler} into a
 * resident safe region, atomically repoints the live KERNAL IRQ vector `$0314`
 * at it, and resumes. The next natural interrupt enters the handler, which saves
 * the register frame and freezes. The app polls the `captured` flag, reads the
 * scratch block (the verified {@link CpuState}), and either resumes the program
 * transparently (restore the vector + release) or leaves it frozen for a Restore.
 *
 * This module is origin-independent: it probes the live vectors each time and
 * makes no assumption about how the running program was started.
 */

/** Minimal structural slice of the REST client this module needs. */
export type CaptureCpuApi = {
  machinePause: () => Promise<{ errors: string[] }>;
  machineResume: () => Promise<{ errors: string[] }>;
  readMemory: (address: string, length?: number, options?: Record<string, unknown>) => Promise<Uint8Array>;
  writeMemoryBlock: (address: string, data: Uint8Array, options?: Record<string, unknown>) => Promise<{ errors: string[] }>;
};

/** The KERNAL IRQ indirect vector (used while KERNAL is mapped — the common case). */
export const IRQ_VECTOR_0314 = 0x0314;

/** A clobbered region whose original bytes must be substituted into the stored snapshot and restored live. */
export type CaptureOverlay = { start: number; bytes: Uint8Array };

export type CaptureResult = {
  cpu: CpuState;
  method: "rli" | "isn";
  /** Original bytes of every region we overwrote (safe region + IRQ vector). */
  overlays: CaptureOverlay[];
  layout: CaptureLayout;
  /** Snapshot of `$01` at capture time. */
  bank01: number;
};

export type CaptureOptions = {
  /** Resident handler/scratch region (default: cassette buffer $033C). */
  safeRegion?: number;
  /** Max time to wait for the natural interrupt to enter the handler. */
  captureTimeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Thrown when capture cannot complete (no interrupt fired; the caller may try ISN or RAM-only). */
export class CpuCaptureFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CpuCaptureFailedError";
  }
}

const DEFAULT_CAPTURE_TIMEOUT_MS = 2000;
const DEFAULT_POLL_INTERVAL_MS = 50;

const toHexAddress = (value: number) => value.toString(16).toUpperCase().padStart(4, "0");
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads the captured register scratch block into a {@link CpuState}. */
const readScratch = async (api: CaptureCpuApi, layout: CaptureLayout): Promise<CpuState> => {
  // The 7 scratch bytes are contiguous: pcl, pch, a, x, y, sp, p (see capturePayload).
  const block = await api.readMemory(toHexAddress(layout.scratchPcl), 7);
  const [pcl, pch, a, x, y, sp, p] = block;
  return { pc: (pch! << 8) | pcl!, a: a!, x: x!, y: y!, sp: sp!, p: p! };
};

/**
 * Captures the live CPU state by riding the running program's IRQ. On success
 * the machine is left frozen in the handler's spin loop; call
 * {@link resumeAfterCapture} to continue the program transparently, or trigger a
 * Restore. Throws {@link CpuCaptureFailedError} if no interrupt fires in time.
 */
export const captureCpuState = async (api: CaptureCpuApi, options: CaptureOptions = {}): Promise<CaptureResult> => {
  const base = options.safeRegion ?? DEFAULT_SAFE_REGION;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const timeout = options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const { bytes: handler, layout } = buildCaptureHandler(base);

  await api.machinePause();
  try {
    // Probe banking and the live IRQ vector + the safe region we are about to use.
    const bank01 = (await api.readMemory(toHexAddress(0x01), 1))[0]!;
    const irqVector = await api.readMemory(toHexAddress(IRQ_VECTOR_0314), 2); // [lo, hi]
    const savedRegion = await api.readMemory(toHexAddress(base), handler.length);

    // Patch the handler: bake the original IRQ vector into origVec, and arm it.
    const patched = new Uint8Array(handler);
    patched[layout.origVec - base] = irqVector[0]!;
    patched[layout.origVec - base + 1] = irqVector[1]!;
    patched[layout.armed - base] = 0x01;
    patched[layout.captured - base] = 0x00;
    patched[layout.release - base] = 0x00;

    await api.writeMemoryBlock(toHexAddress(base), patched);
    // Atomically repoint the live IRQ vector at our handler (a single DMA write).
    await api.writeMemoryBlock(toHexAddress(IRQ_VECTOR_0314), new Uint8Array([base & 0xff, (base >> 8) & 0xff]));

    const overlays: CaptureOverlay[] = [
      { start: base, bytes: savedRegion },
      { start: IRQ_VECTOR_0314, bytes: irqVector },
    ];

    await api.machineResume();

    // Wait for the natural interrupt to enter the handler and capture.
    const deadline = now() + timeout;
    let captured = false;
    for (;;) {
      if ((await api.readMemory(toHexAddress(layout.captured), 1))[0] === 0x01) {
        captured = true;
        break;
      }
      if (now() >= deadline) break;
      await sleep(pollInterval);
    }
    if (!captured) {
      // No interrupt fired (likely an SEI tight loop). Roll back our hook and report;
      // the caller can fall back to ISN (CIA2 NMI) or a RAM-only snapshot.
      await api.machinePause();
      await api.writeMemoryBlock(toHexAddress(IRQ_VECTOR_0314), irqVector);
      await api.writeMemoryBlock(toHexAddress(base), savedRegion);
      await api.machineResume();
      throw new CpuCaptureFailedError("no interrupt entered the capture handler (program may be in an SEI loop)");
    }

    // Read the captured state twice and require it to be stable before trusting it.
    const cpu = await readScratch(api, layout);
    const verify = await readScratch(api, layout);
    if (JSON.stringify(cpu) !== JSON.stringify(verify)) {
      throw new CpuCaptureFailedError("captured register block was not stable across reads");
    }
    assertValidCpuState(cpu);

    return { cpu, method: "rli", overlays, layout, bank01 };
  } catch (error) {
    if (error instanceof CpuCaptureFailedError) throw error;
    // Best-effort: leave the caller a clear error; the machine may be frozen.
    throw error;
  }
};

/**
 * Resumes the program transparently after a capture: restore the original IRQ
 * vector, release the handler's spin loop (it chains to the original handler),
 * then restore the safe region. Returns once the writes are issued.
 */
export const resumeAfterCapture = async (api: CaptureCpuApi, result: CaptureResult): Promise<void> => {
  const { layout, overlays } = result;
  const irqOverlay = overlays.find((o) => o.start === IRQ_VECTOR_0314);
  const regionOverlay = overlays.find((o) => o.start === layout.base);

  // 1) Point the vector back at the original handler so $033C is never re-entered.
  if (irqOverlay) await api.writeMemoryBlock(toHexAddress(IRQ_VECTOR_0314), irqOverlay.bytes);
  // 2) Release the spin loop → the handler chains to the original handler and the program resumes.
  await api.writeMemoryBlock(toHexAddress(layout.release), new Uint8Array([0x01]));
  // 3) Restore the safe region (the live handler is no longer referenced).
  if (regionOverlay) await api.writeMemoryBlock(toHexAddress(layout.base), regionOverlay.bytes);
};
