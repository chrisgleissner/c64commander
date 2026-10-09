/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { findFastForwardPatch, isFastForwardPatchSite } from "@/lib/playback/remoteSeek/sidPlayerFastForwardPatch";
import { placeSidPlayerCode } from "../../../mocks/sidPlayerSimulation";

describe("SID player fast forward patch", () => {
  it("finds the keyboard routine's ldy #0 and the flag it stores into, wherever the player sits", () => {
    for (const keyboardAddress of [0x0340, 0x8a00, 0xc123]) {
      const memory = new Uint8Array(0x10000);
      const placed = placeSidPlayerCode(memory, { keyboardAddress, flagAddress: 0x1fe0 });
      expect(findFastForwardPatch(memory, 0)).toEqual({
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

  it("recognises the patch site only while it still reads ldy #0 or ldy #1", () => {
    expect(isFastForwardPatchSite(Uint8Array.of(0xa0, 0x00))).toBe(true);
    expect(isFastForwardPatchSite(Uint8Array.of(0xa0, 0x01))).toBe(true);
    expect(isFastForwardPatchSite(Uint8Array.of(0xa0, 0x02))).toBe(false);
    expect(isFastForwardPatchSite(Uint8Array.of(0xa9, 0x00))).toBe(false);
  });
});
