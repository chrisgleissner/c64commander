/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Fast forward without key input (Ultimate-II+(L)). The player fast forwards while a flag in its interrupt handler is
// set (player.asm: `fastForward lda #flag / beq`). Its keyboard routine (keyboard.asm) sets it on left-arrow and clears
// it each keyless frame via `ldy #0 / jmp store`, `store` being `sty flag / rts`. Writing 1 into that `ldy #0` holds
// fast forward as the key does; 0 releases it. The routine moves with the tune, so it is found by its code; any link
// that does not match leaves the machine alone.

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

/** The routine's code as found, with the `ldy` operand at 0; the flag byte between them is data. */
export type PatchRoutine = ReadonlyArray<{ address: number; bytes: readonly number[] }>;
/** The operand of the routine's `ldy #0`, the flag it ends up in, and the routine as found. */
export type FastForwardPatch = { ldyOperandAddress: number; flagAddress: number; routine: PatchRoutine };

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
    const bytesAt = (address: number, length: number) =>
      Array.from({ length }, (_, index) =>
        address + index === ldy + 1 ? FAST_FORWARD_RELEASED : byteAt(address + index)!,
      );
    const routine = [
      { address: scanAddress, bytes: bytesAt(scanAddress, ldy + 5 - scanAddress) },
      { address: store, bytes: bytesAt(store, 4) },
      { address: flag - 1, bytes: bytesAt(flag - 1, 1) },
      { address: flag + 1, bytes: bytesAt(flag + 1, 2 + INC_BORDER.length) },
    ];
    return { ldyOperandAddress: ldy + 1, flagAddress: flag, routine };
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

const isFastForwardPatchSite = (ldyBytes: Uint8Array) =>
  ldyBytes[0] === LDY_IMMEDIATE && (ldyBytes[1] === FAST_FORWARD_RELEASED || ldyBytes[1] === FAST_FORWARD_HELD);

/** Reading $DC0D would acknowledge the CIA's interrupts for whatever runs; a link into I/O is no player's. */
const inIo = (address: number) => address >= 0xd000 && address < 0xe000;

/**
 * True when the routine found at `ldyOperandAddress` still links up as the player's, from its
 * `ldy` through `jmp`, `sty flag / rts` to the handler's `lda #flag / beq / inc $d020`. `ldy #1`
 * alone is common code, so another program loaded since would match two bytes.
 */
export const isFastForwardPatchStillThere = async (
  readMemory: (address: string, length: number) => Promise<Uint8Array>,
  ldyOperandAddress: number,
): Promise<boolean> => {
  const hex = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");
  const head = await readMemory(hex(ldyOperandAddress - 1), 5);
  if (!isFastForwardPatchSite(head) || head[2] !== JMP_ABSOLUTE) return false;
  const store = head[3] | (head[4] << 8);
  if (inIo(store)) return false;
  const storeBytes = await readMemory(hex(store), 4);
  if (storeBytes[0] !== STY_ABSOLUTE || storeBytes[3] !== RTS) return false;
  const flag = storeBytes[1] | (storeBytes[2] << 8);
  if (inIo(flag - 1) || inIo(flag + 2 + INC_BORDER.length)) return false;
  const handler = await readMemory(hex(flag - 1), 4 + INC_BORDER.length);
  return handler[0] === LDA_IMMEDIATE && handler[2] === BEQ && matches((address) => handler[address], 4, INC_BORDER);
};

type ReadMemory = (address: string, length: number) => Promise<Uint8Array>;
type WriteMemory = (address: string, data: Uint8Array) => Promise<unknown>;
const hex = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");

/**
 * The routine's bytes that differ from how it was found. Its `ldy` operand must read `operand`, or
 * either 0 or 1 when that is null, as while a seek may be holding it.
 */
export const patchRoutineDifferences = async (
  readMemory: ReadMemory,
  patch: Pick<FastForwardPatch, "ldyOperandAddress" | "routine">,
  operand: number | null = FAST_FORWARD_RELEASED,
): Promise<Array<{ address: number; expected: number; actual: number }>> => {
  const differences: Array<{ address: number; expected: number; actual: number }> = [];
  for (const { address, bytes } of patch.routine) {
    const actual = await readMemory(hex(address), bytes.length);
    bytes.forEach((expected, index) => {
      const at = address + index;
      const isOperand = at === patch.ldyOperandAddress;
      if (
        isOperand &&
        operand === null &&
        (actual[index] === FAST_FORWARD_RELEASED || actual[index] === FAST_FORWARD_HELD)
      )
        return;
      const wanted = isOperand && operand !== null ? operand : expected;
      if (actual[index] !== wanted) differences.push({ address: at, expected: wanted, actual: actual[index] });
    });
  }
  return differences;
};

/** Write back every part of the routine that differs from how it was found, and return what still differs. */
export const restorePatchRoutine = async (
  readMemory: ReadMemory,
  writeMemory: WriteMemory,
  patch: Pick<FastForwardPatch, "ldyOperandAddress" | "routine">,
) => {
  const differing = new Set((await patchRoutineDifferences(readMemory, patch)).map(({ address }) => address));
  for (const { address, bytes } of patch.routine) {
    if (bytes.some((_, index) => differing.has(address + index)))
      await writeMemory(hex(address), Uint8Array.from(bytes));
  }
  return patchRoutineDifferences(readMemory, patch);
};

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
