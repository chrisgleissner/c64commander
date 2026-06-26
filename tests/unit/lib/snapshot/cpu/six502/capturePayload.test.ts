/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildCaptureHandler,
  DEFAULT_SAFE_REGION,
  KERNAL_IRQ_FRAME_BYTES,
} from "@/lib/snapshot/cpu/six502/capturePayload";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

describe("buildCaptureHandler", () => {
  it("emits the exact handler at the cassette buffer with a stable layout", () => {
    const { bytes, layout } = buildCaptureHandler(DEFAULT_SAFE_REGION);
    // Code (70 bytes) followed by 12 data bytes (all zero).
    const code = hex(bytes.subarray(0, 70));
    expect(code).toBe(
      "ad 89 03 d0 03 6c 8c 03 a9 00 8d 89 03 ba bd 01 01 8d 86 03 bd 02 01 8d 85 03 " +
        "bd 03 01 8d 84 03 bd 04 01 8d 88 03 bd 05 01 8d 82 03 bd 06 01 8d 83 03 8a 18 " +
        "69 06 8d 87 03 a9 01 8d 8a 03 ad 8b 03 f0 fb 6c 8c 03",
    );
    expect(bytes.length).toBe(82);
    expect(Array.from(bytes.subarray(70))).toEqual(new Array(12).fill(0));

    expect(layout).toMatchObject({
      base: 0x033c,
      entry: 0x033c,
      scratchPcl: 0x0382,
      scratchPch: 0x0383,
      scratchA: 0x0384,
      scratchX: 0x0385,
      scratchY: 0x0386,
      scratchSp: 0x0387,
      scratchP: 0x0388,
      armed: 0x0389,
      captured: 0x038a,
      release: 0x038b,
      origVec: 0x038c,
      length: 82,
    });
  });

  it("reads the KERNAL IRQ frame at the correct stack offsets (SP+1..SP+6)", () => {
    const { bytes } = buildCaptureHandler(0x033c);
    const code = hex(bytes);
    // Y=SP+1, X=SP+2, A=SP+3, P=SP+4, PCL=SP+5, PCH=SP+6 → LDA $0101,X .. $0106,X
    for (const off of ["01 01", "02 01", "03 01", "04 01", "05 01", "06 01"]) {
      expect(code).toContain(`bd ${off}`); // LDA $01nn,X
    }
    // SP is reconstructed as entry SP + 6 (CPU pushes 3, KERNAL pushes 3).
    expect(KERNAL_IRQ_FRAME_BYTES).toBe(6);
    expect(code).toContain("69 06"); // ADC #$06
  });

  it("is relocatable: absolute references track a different base", () => {
    const { bytes, layout } = buildCaptureHandler(0xc000);
    expect(layout.entry).toBe(0xc000);
    // armed flag is at base + 0x4d (0x0389 - 0x033c); the first LDA absolute references it.
    expect(layout.armed).toBe(0xc000 + (0x0389 - 0x033c));
    // First instruction LDA armed → AD <lo> <hi> of the armed address.
    expect(bytes[0]).toBe(0xad);
    expect(bytes[1]).toBe(layout.armed & 0xff);
    expect(bytes[2]).toBe((layout.armed >> 8) & 0xff);
  });
});

import { buildRawCaptureHandler, RAW_IRQ_FRAME_BYTES } from "@/lib/snapshot/cpu/six502/capturePayload";

describe("buildRawCaptureHandler (KERNAL banked out — $FFFE / +3 frame)", () => {
  it("saves live A/X/Y and reads the 3-byte CPU frame", () => {
    const { bytes, layout } = buildRawCaptureHandler(0x033c);
    const code = hex(bytes.subarray(0, 73));
    // STA scrA first (A is live), then armed check, save X/Y, read P/PCL/PCH at SP+1..3, SP=entry+3.
    expect(code.startsWith("8d 87 03 ad 8c 03 d0 06")).toBe(true);
    expect(code).toContain("8e 88 03"); // STX scrX (live X)
    expect(code).toContain("8c 89 03"); // STY scrY (live Y)
    for (const off of ["01 01", "02 01", "03 01"]) expect(code).toContain(`bd ${off}`); // P,PCL,PCH at SP+1..3
    expect(code).toContain("69 03"); // ADC #$03 → SP = entry + 3
    expect(RAW_IRQ_FRAME_BYTES).toBe(3);
    expect(bytes.length).toBe(85);
    expect(layout.captured).toBe(0x038d);
  });

  it("relocates cleanly to a different base", () => {
    const { layout, bytes } = buildRawCaptureHandler(0xc000);
    expect(layout.entry).toBe(0xc000);
    expect(bytes[0]).toBe(0x8d); // STA scrA
    expect(bytes[1]).toBe(layout.scratchA & 0xff);
  });
});

import { buildNmiCaptureHandler, CIA2_ICR_ADDR } from "@/lib/snapshot/cpu/six502/capturePayload";

describe("buildNmiCaptureHandler (ISN — injected CIA2 NMI for SEI loops)", () => {
  it("acks CIA2 ($DD0D), reads the +3 frame, and RTIs (no chaining)", () => {
    const { bytes, layout } = buildNmiCaptureHandler(0x033c);
    const code = hex(bytes);
    expect(code).toContain("ad 0d dd"); // LDA $DD0D — acknowledge the CIA2 NMI source
    expect(code).toContain("69 03"); // ADC #$03 → NMI frame is +3
    expect(code).toContain(" 40 "); // RTI (injected NMI → return directly, no chain)
    expect(CIA2_ICR_ADDR).toBe(0xdd0d);
    expect(bytes.length).toBe(90);
    expect(layout.captured).toBe(0x0392);
  });
});
