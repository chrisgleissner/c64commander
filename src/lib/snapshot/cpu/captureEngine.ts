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
  buildRawCaptureHandler,
  DEFAULT_SAFE_REGION,
  type CaptureHandler,
  type CaptureLayout,
} from "./six502/capturePayload";
import { addErrorLog } from "@/lib/logging";

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
  writeMemoryBlock: (
    address: string,
    data: Uint8Array,
    options?: Record<string, unknown>,
  ) => Promise<{ errors: string[] }>;
};

/** The KERNAL IRQ indirect vector (used while KERNAL is mapped — the common case). */
export const IRQ_VECTOR_0314 = 0x0314;
/** The CPU hardware IRQ/BRK vector in RAM (used when KERNAL is banked out). */
export const IRQ_VECTOR_FFFE = 0xfffe;

/** A clobbered region whose original bytes must be substituted into the stored snapshot and restored live. */
export type CaptureOverlay = { start: number; bytes: Uint8Array };

export type CaptureResult = {
  cpu: CpuState;
  method: "rli" | "isn";
  /** Original bytes of every region we overwrote (safe region + interrupt vector). */
  overlays: CaptureOverlay[];
  layout: CaptureLayout;
  /** The interrupt vector address that was hooked ($0314 or $FFFE). */
  vectorAddr: number;
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

type PendingPatch = { vectorAddr: number; irqVector: Uint8Array; savedRegion: Uint8Array; base: number };

/**
 * Best-effort restoration of a live capture patch: pause, put the original IRQ
 * vector and safe-region bytes back, and resume. Used during error recovery so a
 * transport failure mid-capture does not leave the C64 frozen with the IRQ vector
 * repointed at the (now-stale) handler. Restore failures are logged, never
 * rethrown — the originating capture error must still propagate to the caller.
 */
const restorePatch = async (api: CaptureCpuApi, patch: PendingPatch, cause: string): Promise<void> => {
  try {
    await api.machinePause();
    await api.writeMemoryBlock(toHexAddress(patch.vectorAddr), patch.irqVector);
    await api.writeMemoryBlock(toHexAddress(patch.base), patch.savedRegion);
    await api.machineResume();
  } catch (error) {
    addErrorLog("Failed to restore machine state after CPU snapshot capture", {
      cause,
      error: (error as Error).message,
      vectorAddr: patch.vectorAddr,
    });
  }
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

  // The 6510 port ($01) cannot be read reliably over DMA, so we don't guess the
  // banking. Instead we try the interrupt vector the program is most likely using
  // and fall back: $0314 (KERNAL mapped — the common case, A/X/Y pushed by $FF48,
  // +6 frame) then the raw RAM vector $FFFE (KERNAL banked out — A/X/Y live, +3
  // frame). Whichever handler fires has the correct frame arithmetic baked in.
  const candidates: Array<{ vectorAddr: number; build: () => CaptureHandler }> = [
    { vectorAddr: IRQ_VECTOR_0314, build: () => buildCaptureHandler(base) },
    { vectorAddr: IRQ_VECTOR_FFFE, build: () => buildRawCaptureHandler(base) },
  ];

  await api.machinePause(); // each attempt starts from a paused machine
  // Tracks the most recent live patch so the catch can undo it on a transport
  // failure mid-capture (machineResume/readMemory/writeMemoryBlock errors after
  // the handler + vector were installed). Cleared by the clean timeout rollback.
  let rollback: PendingPatch | null = null;
  try {
    for (const { vectorAddr, build } of candidates) {
      const { bytes: handler, layout } = build();
      const irqVector = await api.readMemory(toHexAddress(vectorAddr), 2); // [lo, hi]
      const savedRegion = await api.readMemory(toHexAddress(base), handler.length);

      const patched = new Uint8Array(handler);
      patched[layout.origVec - base] = irqVector[0]!;
      patched[layout.origVec - base + 1] = irqVector[1]!;
      patched[layout.armed - base] = 0x01;
      patched[layout.captured - base] = 0x00;
      patched[layout.release - base] = 0x00;

      await api.writeMemoryBlock(toHexAddress(base), patched);
      // Atomically repoint the live interrupt vector at our handler (one DMA write).
      await api.writeMemoryBlock(toHexAddress(vectorAddr), new Uint8Array([base & 0xff, (base >> 8) & 0xff]));
      await api.machineResume();
      rollback = { vectorAddr, irqVector, savedRegion, base };

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
        // This vector's interrupt never fired. Roll back and stay paused so the
        // next candidate can install cleanly.
        await api.machinePause();
        await api.writeMemoryBlock(toHexAddress(vectorAddr), irqVector);
        await api.writeMemoryBlock(toHexAddress(base), savedRegion);
        continue;
      }

      // Captured. Read the scratch twice and require it stable before trusting it.
      const cpu = await readScratch(api, layout);
      const verify = await readScratch(api, layout);
      if (JSON.stringify(cpu) !== JSON.stringify(verify)) {
        // Capture fired but the registers were not stable; release the program
        // before surfacing the failure so the machine is not left frozen.
        await restorePatch(api, rollback, "register block was not stable across reads");
        throw new CpuCaptureFailedError("captured register block was not stable across reads");
      }
      assertValidCpuState(cpu);

      const overlays: CaptureOverlay[] = [
        { start: base, bytes: savedRegion },
        { start: vectorAddr, bytes: irqVector },
      ];
      // $01 isn't reliably readable; the snapshot's banking comes from the RAM dump.
      return { cpu, method: "rli", overlays, layout, vectorAddr, bank01: 0 };
    }

    // Neither vector's interrupt fired (SEI tight loop / vector-protected program).
    await api.machineResume();
    throw new CpuCaptureFailedError(
      "no interrupt entered the capture handler (program runs with interrupts disabled or protects its vectors)",
    );
  } catch (error) {
    // CpuCaptureFailedError paths (timeout / no interrupt / unstable read) have
    // already restored the machine; only recover from mid-patch transport errors
    // that leave the IRQ vector repointed and the safe region overwritten.
    if (!(error instanceof CpuCaptureFailedError) && rollback) {
      await restorePatch(api, rollback, (error as Error).message);
    }
    throw error;
  }
};

/**
 * Resumes the program transparently after a capture: restore the original IRQ
 * vector, release the handler's spin loop (it chains to the original handler),
 * then restore the safe region. Returns once the writes are issued.
 */
export const resumeAfterCapture = async (api: CaptureCpuApi, result: CaptureResult): Promise<void> => {
  const { layout, overlays, vectorAddr } = result;
  const irqOverlay = overlays.find((o) => o.start === vectorAddr);
  const regionOverlay = overlays.find((o) => o.start === layout.base);

  // 1) Point the vector back at the original handler so $033C is never re-entered.
  if (irqOverlay) await api.writeMemoryBlock(toHexAddress(vectorAddr), irqOverlay.bytes);
  // 2) Release the spin loop → the handler chains to the original handler and the program resumes.
  await api.writeMemoryBlock(toHexAddress(layout.release), new Uint8Array([0x01]));
  // 3) Restore the safe region (the live handler is no longer referenced).
  if (regionOverlay) await api.writeMemoryBlock(toHexAddress(layout.base), regionOverlay.bytes);
};
