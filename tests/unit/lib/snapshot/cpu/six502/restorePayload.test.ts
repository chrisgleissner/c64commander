/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildFinalizeStub,
  buildRestoreImage,
  CART_IMAGE_SIZE,
  RESTORE_FLAG_GO,
  RESTORE_FLAG_READY,
} from "@/lib/snapshot/cpu/six502/restorePayload";
import type { CpuState } from "@/lib/snapshot/cpu/cpuState";

const STATE: CpuState = { pc: 0xc000, a: 0x12, x: 0x34, y: 0x56, sp: 0xf8, p: 0xa1 };
const CTX = { mem01: 0x37, mem02: 0x00 };

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

const indexOf = (haystack: Uint8Array, needle: Uint8Array): number => {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

describe("buildFinalizeStub", () => {
  it("emits the exact disable → restore-$02/$01 → set SP/Y/A/X → RTI sequence", () => {
    const stub = buildFinalizeStub(STATE, CTX);
    // A9 40       LDA #$40
    // 8D FF DF    STA $DFFF      (disable c_8k cart)
    // A9 00       LDA #$00       (mem02)
    // 85 02       STA $02
    // A9 37       LDA #$37       (mem01)
    // 85 01       STA $01
    // A2 F5       LDX #$F5       (sp-3 = $F8-3)
    // 9A          TXS
    // A0 56       LDY #$56
    // A9 12       LDA #$12
    // A2 34       LDX #$34
    // 40          RTI
    expect(hex(stub)).toBe("a9 40 8d ff df a9 00 85 02 a9 37 85 01 a2 f5 9a a0 56 a9 12 a2 34 40");
    expect(stub.length).toBe(23);
  });

  it("bakes sp-3 with wraparound for a low SP", () => {
    const stub = buildFinalizeStub({ ...STATE, sp: 0x01 }, CTX);
    // sp-3 = 0x01-3 = 0xFE (wraps); LDX #$FE = A2 FE
    expect(indexOf(stub, new Uint8Array([0xa2, 0xfe]))).toBeGreaterThanOrEqual(0);
  });
});

describe("buildRestoreImage", () => {
  it("is exactly 8 KiB", () => {
    expect(buildRestoreImage(STATE, CTX).length).toBe(CART_IMAGE_SIZE);
  });

  it("starts with cold/warm vectors and the CBM80 signature", () => {
    const img = buildRestoreImage(STATE, CTX);
    // Header is dw(cold) dw(warm) db("CBM80") = 9 bytes, so coldStart is at $8009.
    expect(img[0]).toBe(0x09);
    expect(img[1]).toBe(0x80);
    // CBM80 at offset 4
    expect(Array.from(img.subarray(4, 9))).toEqual([0xc3, 0xc2, 0xcd, 0x38, 0x30]);
  });

  it("arms the handshake: writes READY to $02 then spins until GO", () => {
    const img = buildRestoreImage(STATE, CTX);
    // LDA #READY ; STA $02  →  A9 A5 85 02
    expect(indexOf(img, new Uint8Array([0xa9, RESTORE_FLAG_READY, 0x85, 0x02]))).toBeGreaterThanOrEqual(0);
    // CMP #GO  →  C9 5A
    expect(indexOf(img, new Uint8Array([0xc9, RESTORE_FLAG_GO]))).toBeGreaterThanOrEqual(0);
  });

  it("embeds the finalize stub verbatim", () => {
    const img = buildRestoreImage(STATE, CTX);
    const stub = buildFinalizeStub(STATE, CTX);
    expect(indexOf(img, stub)).toBeGreaterThanOrEqual(0);
  });

  it("pads the tail with zeroes", () => {
    const img = buildRestoreImage(STATE, CTX);
    expect(img[CART_IMAGE_SIZE - 1]).toBe(0x00);
  });
});
