/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  assemble,
  bcc,
  beq,
  bne,
  db,
  jmp,
  label,
  lda,
  ldx,
  ldy,
  org,
  rti,
  sei,
  sta,
  stx,
  tsx,
  txs,
} from "@/lib/snapshot/cpu/six502/assembler";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

describe("six502 assembler — canonical encodings", () => {
  it("encodes implied instructions", () => {
    expect(hex(assemble([sei()], 0x8000).bytes)).toBe("78");
    expect(hex(assemble([rti()], 0x8000).bytes)).toBe("40");
    expect(hex(assemble([tsx()], 0x8000).bytes)).toBe("ba");
    expect(hex(assemble([txs()], 0x8000).bytes)).toBe("9a");
  });

  it("encodes immediate loads (LDA/LDX/LDY #imm)", () => {
    expect(hex(assemble([lda.imm(0x12)], 0x8000).bytes)).toBe("a9 12");
    expect(hex(assemble([ldx.imm(0x34)], 0x8000).bytes)).toBe("a2 34");
    expect(hex(assemble([ldy.imm(0x56)], 0x8000).bytes)).toBe("a0 56");
  });

  it("encodes zero-page loads/stores", () => {
    expect(hex(assemble([lda.zp(0x01)], 0x8000).bytes)).toBe("a5 01");
    expect(hex(assemble([sta.zp(0x01)], 0x8000).bytes)).toBe("85 01");
  });

  it("encodes absolute loads/stores with little-endian addresses", () => {
    expect(hex(assemble([lda.abs(0xd020)], 0x8000).bytes)).toBe("ad 20 d0");
    expect(hex(assemble([sta.abs(0xdd0d)], 0x8000).bytes)).toBe("8d 0d dd");
    expect(hex(assemble([stx.abs(0xc000)], 0x8000).bytes)).toBe("8e 00 c0");
  });

  it("encodes JMP absolute and indirect", () => {
    expect(hex(assemble([jmp.abs(0xfce2)], 0x8000).bytes)).toBe("4c e2 fc");
    expect(hex(assemble([jmp.ind(0x0314)], 0x8000).bytes)).toBe("6c 14 03");
  });
});

describe("six502 assembler — labels and branches", () => {
  it("resolves an absolute label reference to its address", () => {
    const { bytes, symbols } = assemble([label("here"), jmp.abs("here")], 0xc000);
    expect(symbols.here).toBe(0xc000);
    expect(hex(bytes)).toBe("4c 00 c0");
  });

  it("computes a backward branch displacement", () => {
    // spin: LDA $C100 ; BNE spin
    const { bytes } = assemble([label("spin"), lda.abs(0xc100), bne("spin")], 0xc000);
    // LDA abs = 3 bytes, BNE at C003, next instr at C005, target C000 → delta -5 = 0xFB
    expect(hex(bytes)).toBe("ad 00 c1 d0 fb");
  });

  it("computes a forward branch displacement", () => {
    // BNE skip ; LDA #$00 ; skip: RTI
    const { bytes } = assemble([bne("skip"), lda.imm(0x00), label("skip"), rti()], 0xc000);
    // BNE at C000 (next = C002), LDA#imm 2 bytes → skip at C004, delta +2 = 0x02
    expect(hex(bytes)).toBe("d0 02 a9 00 40");
  });

  it("throws when a branch target is out of reach", () => {
    const program = [bne("far"), db(...new Array(200).fill(0xea)), label("far"), rti()];
    expect(() => assemble(program, 0xc000)).toThrow(/branch out of range/);
  });

  it("throws on an undefined label", () => {
    expect(() => assemble([jmp.abs("nowhere")], 0xc000)).toThrow(/undefined label/);
  });

  it("throws on a duplicate label", () => {
    expect(() => assemble([label("x"), label("x")], 0xc000)).toThrow(/duplicate label/);
  });
});

describe("six502 assembler — .org, .db and validation", () => {
  it("emits raw bytes via db", () => {
    expect(hex(assemble([db(0x01, 0x02, 0x03)], 0x8000).bytes)).toBe("01 02 03");
  });

  it("pads forward to a later .org with zeroes", () => {
    const { bytes } = assemble([lda.imm(0xff), org(0x8004), rti()], 0x8000);
    // a9 ff (2 bytes) then pad to offset 4 then 40
    expect(hex(bytes)).toBe("a9 ff 00 00 40");
  });

  it("places the reset vector at a fixed offset using .org", () => {
    const { bytes, symbols } = assemble([label("start"), rti(), org(0x800c), db(0x00, 0x80)], 0x8000);
    expect(symbols.start).toBe(0x8000);
    expect(bytes.length).toBe(0x0e);
    expect(bytes[0x0c]).toBe(0x00);
    expect(bytes[0x0d]).toBe(0x80);
  });

  it("rejects an immediate operand above a byte", () => {
    expect(() => assemble([lda.imm(0x100)], 0x8000)).toThrow(/8-bit operand out of range/);
  });

  it("rejects an unsupported mnemonic/mode pair lacking an opcode", () => {
    // cmp has no absy form in this assembler; calling it as a raw op would 404.
    expect(() => assemble([{ t: "op", mnemonic: "CMP", mode: "absy", operand: 0x1000 }], 0x8000)).toThrow(/no opcode/);
  });

  it("rejects a backwards .org", () => {
    expect(() => assemble([rti(), rti(), org(0x8000)], 0x8000)).toThrow(/moves backwards/);
  });
});

describe("six502 assembler — a representative spin/finalize sketch", () => {
  it("assembles a spin-then-RTI loop deterministically", () => {
    const RELEASE = 0xcfff;
    const { bytes } = assemble(
      [sei(), label("wait"), lda.abs(RELEASE), beq("wait"), ldx.imm(0xfb), txs(), rti()],
      0x8000,
    );
    // 78 | ad ff cf | f0 fb | a2 fb | 9a | 40
    expect(hex(bytes)).toBe("78 ad ff cf f0 fb a2 fb 9a 40");
    expect(bytes.length).toBe(10);
  });
});
