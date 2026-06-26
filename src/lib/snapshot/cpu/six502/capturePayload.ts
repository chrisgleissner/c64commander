/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  adc,
  assemble,
  beq,
  bne,
  clc,
  db,
  dw,
  jmp,
  label,
  lda,
  ldx,
  ldy,
  rti,
  sta,
  stx,
  sty,
  tsx,
  txa,
} from "./assembler";

/**
 * The RLI (Ride the Live Interrupt) capture handler.
 *
 * Installed into a resident safe region (default: the cassette buffer `$033C`),
 * this small handler is chained onto the interrupt the running program already
 * uses. We hook the KERNAL IRQ vector `$0314` (the common case: KERNAL mapped,
 * the CPU IRQ enters `$FF48` which pushes A/X/Y, then `JMP ($0314)`).
 *
 * At handler entry the stack therefore holds, from the top (lowest address
 * first, `TSX` gives the entry SP in X):
 *
 *   $0100+SP+1 = Y      (pushed last by $FF48: TYA/PHA)
 *   $0100+SP+2 = X
 *   $0100+SP+3 = A
 *   $0100+SP+4 = P      (pushed by the CPU on IRQ entry)
 *   $0100+SP+5 = PCL
 *   $0100+SP+6 = PCH
 *
 * The program's true SP at the instant of interruption is the entry SP + 6
 * (3 bytes pushed by the CPU + 3 by the KERNAL). The handler copies the frame
 * into a scratch block, sets a `captured` flag, then **spins** (freeze model):
 * the machine is held at a transparent interrupt boundary so the app can DMA a
 * fully consistent RAM image. (Transparent resume — chaining back through the
 * original vector — is a separate step driven by the `release` flag.)
 *
 * `armed` lets the app gate exactly one capture; `origVec` holds the original
 * `$0314` so a not-yet-armed interrupt (or a released handler) can chain on.
 */

/** Absolute addresses of every field the orchestrator reads/writes, for a given base. */
export type CaptureLayout = {
  base: number;
  entry: number;
  scratchPcl: number;
  scratchPch: number;
  scratchA: number;
  scratchX: number;
  scratchY: number;
  scratchSp: number;
  scratchP: number;
  armed: number;
  captured: number;
  release: number;
  origVec: number;
  /** Total byte length of code + data. */
  length: number;
};

export type CaptureHandler = {
  bytes: Uint8Array;
  layout: CaptureLayout;
};

/** Number of bytes the IRQ frame occupies when KERNAL is mapped (CPU 3 + KERNAL A/X/Y 3). */
export const KERNAL_IRQ_FRAME_BYTES = 6;

/** Default resident scratch/handler region — the cassette buffer (free on most non-tape programs). */
export const DEFAULT_SAFE_REGION = 0x033c;

/**
 * Builds the capture handler positioned at `base`. The returned {@link CaptureLayout}
 * gives the orchestrator the absolute addresses of the flags and scratch bytes.
 */
export const buildCaptureHandler = (base = DEFAULT_SAFE_REGION): CaptureHandler => {
  const { bytes, symbols } = assemble(
    [
      // --- entry: capture only when armed, else chain to the original handler ---
      label("entry"),
      lda.abs("armed"),
      bne("doCapture"),
      jmp.ind("origVec"),

      label("doCapture"),
      lda.imm(0x00),
      sta.abs("armed"), // disarm: capture exactly once
      tsx(),
      lda.absx(0x0101),
      sta.abs("scrY"),
      lda.absx(0x0102),
      sta.abs("scrX"),
      lda.absx(0x0103),
      sta.abs("scrA"),
      lda.absx(0x0104),
      sta.abs("scrP"),
      lda.absx(0x0105),
      sta.abs("scrPcl"),
      lda.absx(0x0106),
      sta.abs("scrPch"),
      txa(),
      clc(),
      adc.imm(KERNAL_IRQ_FRAME_BYTES), // SP at interrupt = entry SP + 6
      sta.abs("scrSp"),
      lda.imm(0x01),
      sta.abs("captured"),

      // --- freeze: hold the machine until the app releases ---
      label("freeze"),
      lda.abs("release"),
      beq("freeze"),
      jmp.ind("origVec"), // released: chain to the original handler → transparent resume

      // --- data ---
      label("scrPcl"),
      db(0),
      label("scrPch"),
      db(0),
      label("scrA"),
      db(0),
      label("scrX"),
      db(0),
      label("scrY"),
      db(0),
      label("scrSp"),
      db(0),
      label("scrP"),
      db(0),
      label("armed"),
      db(0),
      label("captured"),
      db(0),
      label("release"),
      db(0),
      label("origVec"),
      dw(0),
    ],
    base,
  );

  const layout: CaptureLayout = {
    base,
    entry: symbols.entry!,
    scratchPcl: symbols.scrPcl!,
    scratchPch: symbols.scrPch!,
    scratchA: symbols.scrA!,
    scratchX: symbols.scrX!,
    scratchY: symbols.scrY!,
    scratchSp: symbols.scrSp!,
    scratchP: symbols.scrP!,
    armed: symbols.armed!,
    captured: symbols.captured!,
    release: symbols.release!,
    origVec: symbols.origVec!,
    length: bytes.length,
  };

  return { bytes, layout };
};

/** Number of bytes the IRQ/NMI frame occupies when KERNAL is banked out (CPU pushes P/PCL/PCH only). */
export const RAW_IRQ_FRAME_BYTES = 3;

/**
 * Builds a *raw* capture handler for when KERNAL is banked out (`$01` HIRAM clear)
 * and the program's interrupt vectors live in RAM (`$FFFE` for IRQ/BRK, `$FFFA`
 * for NMI). The CPU pushes only P/PCL/PCH (3 bytes) and jumps straight to the
 * program's handler — so A/X/Y are *live registers*, not on the stack, and this
 * handler saves them directly. The captured SP is the entry SP + 3.
 *
 * On release it restores A/X/Y and chains to the program's original handler
 * (`origVec`), so the program's own interrupt servicing (ACK etc.) still runs.
 */
export const buildRawCaptureHandler = (base = DEFAULT_SAFE_REGION): CaptureHandler => {
  const { bytes, symbols } = assemble(
    [
      label("entry"),
      sta.abs("scrA"), // A is live → save it before anything clobbers it
      lda.abs("armed"),
      bne("doCapture"),
      lda.abs("scrA"), // not armed → restore A and chain cleanly
      jmp.ind("origVec"),

      label("doCapture"),
      lda.imm(0x00),
      sta.abs("armed"),
      stx.abs("scrX"), // X live → save
      sty.abs("scrY"), // Y live → save
      tsx(),
      lda.absx(0x0101),
      sta.abs("scrP"),
      lda.absx(0x0102),
      sta.abs("scrPcl"),
      lda.absx(0x0103),
      sta.abs("scrPch"),
      txa(),
      clc(),
      adc.imm(RAW_IRQ_FRAME_BYTES), // SP at interrupt = entry SP + 3
      sta.abs("scrSp"),
      lda.imm(0x01),
      sta.abs("captured"),

      label("freeze"),
      lda.abs("release"),
      beq("freeze"),
      // transparent resume: restore A/X/Y, chain to the program's own handler
      ldy.abs("scrY"),
      ldx.abs("scrX"),
      lda.abs("scrA"),
      jmp.ind("origVec"),

      label("scrPcl"),
      db(0),
      label("scrPch"),
      db(0),
      label("scrA"),
      db(0),
      label("scrX"),
      db(0),
      label("scrY"),
      db(0),
      label("scrSp"),
      db(0),
      label("scrP"),
      db(0),
      label("armed"),
      db(0),
      label("captured"),
      db(0),
      label("release"),
      db(0),
      label("origVec"),
      dw(0),
    ],
    base,
  );

  const layout: CaptureLayout = {
    base,
    entry: symbols.entry!,
    scratchPcl: symbols.scrPcl!,
    scratchPch: symbols.scrPch!,
    scratchA: symbols.scrA!,
    scratchX: symbols.scrX!,
    scratchY: symbols.scrY!,
    scratchSp: symbols.scrSp!,
    scratchP: symbols.scrP!,
    armed: symbols.armed!,
    captured: symbols.captured!,
    release: symbols.release!,
    origVec: symbols.origVec!,
    length: bytes.length,
  };

  return { bytes, layout };
};
