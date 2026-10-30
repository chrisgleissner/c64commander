/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { and, assemble, beq, bne, db, dw, inx, jmp, label, lda, ldx, pha, pla, sta, type Stmt } from "./assembler";
import { DEFAULT_SAFE_REGION } from "./capturePayload";

/**
 * The character ROM copy handler, chained onto the KERNAL IRQ vector `$0314` like the RLI capture
 * handler.
 *
 * `$D000-$DFFF` shows the character ROM only while CHAREN (bit 2 of the 6510 port `$01`) is clear,
 * and that port is inside the CPU: a DMA write to `$01` lands in RAM and changes nothing. So the
 * copy has to run on the C64's own CPU. Entered once (`armed`), the handler clears CHAREN, copies
 * the 4 KiB into a RAM buffer, puts `$01` back, raises `done` and then holds the machine until the
 * app sets `release`, so the running program never sees the buffer while it holds the copy.
 */

export const CHARACTER_ROM_ADDRESS = 0xd000;
export const CHARACTER_ROM_BYTES = 4096;
/** Always RAM, whatever the banking, so a DMA read of it returns what the handler wrote. */
export const CHARACTER_ROM_COPY_BUFFER = 0xc000;

const CPU_PORT = 0x01;
const CLEAR_CHAREN = 0xfb;
const PAGE = 0x100;

export type CharacterRomCopyLayout = {
  base: number;
  buffer: number;
  /** `armed` and `done` are adjacent, so one two-byte read returns both. */
  armed: number;
  done: number;
  release: number;
  origVec: number;
  length: number;
};

export type CharacterRomCopyHandler = { bytes: Uint8Array; layout: CharacterRomCopyLayout };

const copyEveryPageAtX = (buffer: number): Stmt[] =>
  Array.from({ length: CHARACTER_ROM_BYTES / PAGE }, (_, page) => [
    lda.absx(CHARACTER_ROM_ADDRESS + page * PAGE),
    sta.absx(buffer + page * PAGE),
  ]).flat();

export const buildCharacterRomCopyHandler = (
  base = DEFAULT_SAFE_REGION,
  buffer = CHARACTER_ROM_COPY_BUFFER,
): CharacterRomCopyHandler => {
  const { bytes, symbols } = assemble(
    [
      label("entry"),
      lda.abs("armed"),
      bne("copy"),
      jmp.ind("origVec"),

      label("copy"),
      lda.imm(0x00),
      sta.abs("armed"),
      lda.zp(CPU_PORT),
      pha(),
      and.imm(CLEAR_CHAREN),
      sta.zp(CPU_PORT),
      ldx.imm(0x00),
      label("byte"),
      ...copyEveryPageAtX(buffer),
      inx(),
      bne("byte"),
      pla(),
      sta.zp(CPU_PORT),
      lda.imm(0x01),
      sta.abs("done"),

      label("hold"),
      lda.abs("release"),
      beq("hold"),
      jmp.ind("origVec"),

      label("armed"),
      db(0),
      label("done"),
      db(0),
      label("release"),
      db(0),
      label("origVec"),
      dw(0),
    ],
    base,
  );

  return {
    bytes,
    layout: {
      base,
      buffer,
      armed: symbols.armed,
      done: symbols.done,
      release: symbols.release,
      origVec: symbols.origVec,
      length: bytes.length,
    },
  };
};
