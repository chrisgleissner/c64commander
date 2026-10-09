/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Fast forward on a machine that takes no key input, such as the Ultimate-II+(L).
 *
 * The SID player fast forwards while a flag in its interrupt handler is set
 * (player.asm: `fastForward lda #flag / beq`). Its keyboard routine (keyboard.asm) sets that flag
 * when the left-arrow key goes down and clears it on every frame without a key: it ends in
 * `ldy #0 / jmp store`, and `store` is `sty flag / rts`. Writing 1 into that `ldy #0` makes the
 * routine set the flag on every frame instead, which holds fast forward exactly as the key does;
 * writing 0 back releases it.
 *
 * The routine moves with the tune, so it is found by its code. Every link of the chain is checked
 * before the byte is touched, and anything that does not match leaves the machine alone.
 */

/** `sty $dc00 / lda $dc01 / cmp #$ff / bne`: the keyboard routine's row scan. */
const ROW_SCAN = [0x8c, 0x00, 0xdc, 0xad, 0x01, 0xdc, 0xc9, 0xff, 0xd0];
/** The `ldy #0 / jmp` that ends the scan lies this far after it at most. */
const SCAN_TO_RELEASE_WINDOW = 48;
const LDY_IMMEDIATE = 0xa0;
const JMP_ABSOLUTE = 0x4c;
const STY_ABSOLUTE = 0x8c;
const RTS = 0x60;
const LDA_IMMEDIATE = 0xa9;
const BEQ = 0xf0;
/** `inc $d020`: the border flash the handler shows while it fast forwards. */
const INC_BORDER = [0xee, 0x20, 0xd0];

/** The operand of the routine's `ldy #0` and the flag it ends up in. */
export type FastForwardPatch = { ldyOperandAddress: number; flagAddress: number };

export const FAST_FORWARD_RELEASED = 0x00;
export const FAST_FORWARD_HELD = 0x01;

type ByteAt = (address: number) => number | undefined;

const matches = (byteAt: ByteAt, address: number, bytes: readonly number[]) =>
  bytes.every((byte, index) => byteAt(address + index) === byte);

const word = (byteAt: ByteAt, address: number) => {
  const low = byteAt(address);
  const high = byteAt(address + 1);
  return low === undefined || high === undefined ? undefined : low | (high << 8);
};

const patchFrom = (byteAt: ByteAt, scanAddress: number): FastForwardPatch | null => {
  for (let offset = ROW_SCAN.length; offset < SCAN_TO_RELEASE_WINDOW; offset += 1) {
    const ldy = scanAddress + offset;
    if (byteAt(ldy) !== LDY_IMMEDIATE || byteAt(ldy + 2) !== JMP_ABSOLUTE) continue;
    const operand = byteAt(ldy + 1);
    if (operand !== FAST_FORWARD_RELEASED && operand !== FAST_FORWARD_HELD) continue;
    const store = word(byteAt, ldy + 3);
    if (store === undefined || byteAt(store) !== STY_ABSOLUTE || byteAt(store + 3) !== RTS) continue;
    const flag = word(byteAt, store + 1);
    if (flag === undefined || byteAt(flag - 1) !== LDA_IMMEDIATE || byteAt(flag + 1) !== BEQ) continue;
    if (!matches(byteAt, flag + 3, INC_BORDER)) continue;
    return { ldyOperandAddress: ldy + 1, flagAddress: flag };
  }
  return null;
};

/**
 * The fast forward patch in `memory`, which holds the machine's bytes from `base` on, or null
 * unless exactly one keyboard routine there links up as the player's.
 */
export const findFastForwardPatch = (memory: Uint8Array, base: number): FastForwardPatch | null => {
  const byteAt: ByteAt = (address) =>
    address >= base && address < base + memory.length ? memory[address - base] : undefined;
  const found: FastForwardPatch[] = [];
  for (let index = 0; index + ROW_SCAN.length <= memory.length; index += 1) {
    if (!matches(byteAt, base + index, ROW_SCAN)) continue;
    const patch = patchFrom(byteAt, base + index);
    if (patch) found.push(patch);
  }
  return found.length === 1 ? found[0] : null;
};

/** True when the two bytes at the `ldy` still read `ldy #0` or `ldy #1`: the routine is still there. */
export const isFastForwardPatchSite = (ldyBytes: Uint8Array) =>
  ldyBytes[0] === LDY_IMMEDIATE && (ldyBytes[1] === FAST_FORWARD_RELEASED || ldyBytes[1] === FAST_FORWARD_HELD);

/** Read in pieces this size, so no single DMA read holds up the tune's CPU for long enough to hear. */
const SCAN_CHUNK_BYTES = 0x800;
/** readmem follows the CPU's banking: under $D000-$DFFF it would read the CIAs, and reading $DC0D acknowledges their interrupts. */
const SCAN_RANGES = [
  [0x0000, 0xd000],
  [0xe000, 0x10000],
] as const;

/** Find the fast forward patch in the machine's memory, or null when the player's keyboard routine is not there. */
export const scanForFastForwardPatch = async (
  readMemory: (address: string, length: number) => Promise<Uint8Array>,
  isCurrent: () => boolean = () => true,
): Promise<FastForwardPatch | null> => {
  const memory = new Uint8Array(0x10000);
  for (const [start, end] of SCAN_RANGES) {
    for (let address = start; address < end; address += SCAN_CHUNK_BYTES) {
      if (!isCurrent()) return null;
      const length = Math.min(SCAN_CHUNK_BYTES, end - address);
      memory.set(
        (await readMemory(address.toString(16).toUpperCase().padStart(4, "0"), length)).subarray(0, length),
        address,
      );
    }
  }
  return findFastForwardPatch(memory, 0);
};
