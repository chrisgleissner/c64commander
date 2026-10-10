/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  findFastForwardPatch,
  isFastForwardPatchStillThere,
  patchRoutineDifferences,
} from "@/lib/playback/remoteSeek/sidPlayerFastForwardPatch";
import { placeSidPlayerCode } from "../../../mocks/sidPlayerSimulation";

describe("SID player fast forward patch", () => {
  it("finds the keyboard routine's ldy #0 and the flag it stores into, wherever the player sits", () => {
    for (const keyboardAddress of [0x0340, 0x8a00, 0xc123]) {
      const memory = new Uint8Array(0x10000);
      const placed = placeSidPlayerCode(memory, { keyboardAddress, flagAddress: 0x1fe0 });
      expect(findFastForwardPatch(memory, 0)).toMatchObject({
        ldyOperandAddress: placed.ldyOperandAddress,
        flagAddress: 0x1fe0,
      });
    }
  });

  it("finds it in a read that starts part way into memory", () => {
    const memory = new Uint8Array(0x10000);
    const placed = placeSidPlayerCode(memory, { keyboardAddress: 0x9000, flagAddress: 0x9800 });
    expect(findFastForwardPatch(memory.subarray(0x8000, 0xa000), 0x8000)?.ldyOperandAddress).toBe(
      placed.ldyOperandAddress,
    );
  });

  it("finds it while the patch is applied", () => {
    const memory = new Uint8Array(0x10000);
    const placed = placeSidPlayerCode(memory, { keyboardAddress: 0x0340, flagAddress: 0x1fe0 });
    memory[placed.ldyOperandAddress] = 1;
    expect(findFastForwardPatch(memory, 0)?.ldyOperandAddress).toBe(placed.ldyOperandAddress);
  });

  it.each([
    [
      "the jump does not lead to a store",
      (placed: { storeAddress: number }, memory: Uint8Array) => (memory[placed.storeAddress] = 0xea),
    ],
    [
      "the store is not followed by rts",
      (placed: { storeAddress: number }, memory: Uint8Array) => (memory[placed.storeAddress + 3] = 0xea),
    ],
    ["the flag is not an lda immediate", (_placed: unknown, memory: Uint8Array) => (memory[0x1fe0 - 1] = 0xad)],
    ["the handler does not flash the border", (_placed: unknown, memory: Uint8Array) => (memory[0x1fe0 + 3] = 0xea)],
  ])("leaves the machine alone when %s", (_name, damage) => {
    const memory = new Uint8Array(0x10000);
    const placed = placeSidPlayerCode(memory, { keyboardAddress: 0x0340, flagAddress: 0x1fe0 });
    damage(placed, memory);
    expect(findFastForwardPatch(memory, 0)).toBeNull();
  });

  it("leaves the machine alone when two routines link up, since it cannot tell which one runs", () => {
    const memory = new Uint8Array(0x10000);
    placeSidPlayerCode(memory, { keyboardAddress: 0x0340, flagAddress: 0x1fe0 });
    placeSidPlayerCode(memory, { keyboardAddress: 0x6000, flagAddress: 0x7000 });
    expect(findFastForwardPatch(memory, 0)).toBeNull();
  });

  const readerOf =
    (memory: Uint8Array, reads: number[] = []) =>
    async (address: string, length: number) => {
      const start = parseInt(address, 16);
      for (let at = start; at < start + length; at += 1) reads.push(at);
      return memory.slice(start, start + length);
    };

  it("still finds the patch site while the whole routine is there, held or released", async () => {
    const memory = new Uint8Array(0x10000);
    const placed = placeSidPlayerCode(memory, { keyboardAddress: 0x0340, flagAddress: 0x1fe0 });
    expect(await isFastForwardPatchStillThere(readerOf(memory), placed.ldyOperandAddress)).toBe(true);
    memory[placed.ldyOperandAddress] = 0x01;
    expect(await isFastForwardPatchStillThere(readerOf(memory), placed.ldyOperandAddress)).toBe(true);
    memory[placed.ldyOperandAddress] = 0x02;
    expect(await isFastForwardPatchStillThere(readerOf(memory), placed.ldyOperandAddress)).toBe(false);
  });

  it("does not take another program's ldy #1 at that address for the player's", async () => {
    const memory = new Uint8Array(0x10000);
    const placed = placeSidPlayerCode(memory, { keyboardAddress: 0x0340, flagAddress: 0x1fe0 });
    memory.fill(0xea, 0x0340, 0x0380);
    memory.set([0xa0, 0x01, 0x4c], placed.ldyOperandAddress - 1);
    memory.set([placed.storeAddress & 0xff, placed.storeAddress >> 8], placed.ldyOperandAddress + 2);
    memory.set([0x8d, 0x00, 0x04, 0x60], placed.storeAddress);
    expect(await isFastForwardPatchStillThere(readerOf(memory), placed.ldyOperandAddress)).toBe(false);
  });

  it("records the routine as found, with its ldy at 0 and the flag byte left out", () => {
    const memory = new Uint8Array(0x10000);
    const placed = placeSidPlayerCode(memory, { keyboardAddress: 0x0340, flagAddress: 0x1fe0 });
    memory[placed.ldyOperandAddress] = 0x01;
    const { routine } = findFastForwardPatch(memory, 0)!;
    const covered = routine.flatMap(({ address, bytes }) => bytes.map((_, index) => address + index));
    expect(covered).toContain(placed.ldyOperandAddress);
    expect(covered).not.toContain(0x1fe0);
    const operandRegion = routine.find(({ address, bytes }) => placed.ldyOperandAddress < address + bytes.length)!;
    expect(operandRegion.bytes[placed.ldyOperandAddress - operandRegion.address]).toBe(0x00);
  });

  it("names every byte of the routine that differs from how it was found", async () => {
    const memory = new Uint8Array(0x10000);
    const placed = placeSidPlayerCode(memory, { keyboardAddress: 0x0340, flagAddress: 0x1fe0 });
    const patch = findFastForwardPatch(memory, 0)!;
    memory[0x1fe0] = 0x01;
    expect(await patchRoutineDifferences(readerOf(memory), patch)).toEqual([]);
    memory[placed.ldyOperandAddress] = 0x01;
    expect(await patchRoutineDifferences(readerOf(memory), patch, null)).toEqual([]);
    memory[placed.storeAddress + 3] = 0xea;
    expect(await patchRoutineDifferences(readerOf(memory), patch)).toEqual([
      { address: placed.ldyOperandAddress, expected: 0x00, actual: 0x01 },
      { address: placed.storeAddress + 3, expected: 0x60, actual: 0xea },
    ]);
  });

  it("never reads I/O when a jump there would be followed, since reading $DC0D acknowledges an interrupt", async () => {
    const memory = new Uint8Array(0x10000);
    memory.set([0xa0, 0x01, 0x4c, 0x0d, 0xdc], 0x0400);
    const reads: number[] = [];
    expect(await isFastForwardPatchStillThere(readerOf(memory, reads), 0x0401)).toBe(false);
    expect(reads.filter((address) => address >= 0xd000 && address < 0xe000)).toEqual([]);
  });
});
