/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildCharacterRomCopyHandler,
  CHARACTER_ROM_BYTES,
  CHARACTER_ROM_COPY_BUFFER,
} from "@/lib/snapshot/cpu/six502/characterRomPayload";

const ORIGINAL_IRQ = 0xea31;
const CHAREN = 0x04;

/**
 * Just enough of a 6510 to run the handler: the opcodes it uses, the Z flag its branches test, and
 * the one piece of banking that matters here, `$D000-$DFFF` showing I/O or the character ROM by CHAREN.
 */
class MiniC64 {
  ram = new Uint8Array(0x10000);
  chargen = Uint8Array.from({ length: CHARACTER_ROM_BYTES }, (_, i) => (i * 37 + 11) & 0xff);
  pc = 0;
  a = 0;
  x = 0;
  sp = 0xf0;
  z = false;
  /** Every value the CPU port held, so a test can see CHAREN went back. */
  portHistory: number[] = [];

  read(address: number): number {
    if (address >= 0xd000 && address <= 0xdfff) {
      return this.ram[0x01] & CHAREN ? 0x5a : this.chargen[address - 0xd000];
    }
    return this.ram[address];
  }

  write(address: number, value: number) {
    if (address >= 0xd000 && address <= 0xdfff) return;
    this.ram[address] = value;
    if (address === 0x01) this.portHistory.push(value);
  }

  private word = (address: number) => this.read(address) | (this.read(address + 1) << 8);
  private setA = (value: number) => {
    this.a = value & 0xff;
    this.z = this.a === 0;
  };

  step() {
    const op = this.read(this.pc);
    const abs = this.word(this.pc + 1);
    const imm = this.read(this.pc + 1);
    const branch = () => this.pc + 2 + ((imm << 24) >> 24);
    // prettier-ignore
    switch (op) {
      case 0xa9: this.setA(imm); this.pc += 2; break;
      case 0xa5: this.setA(this.read(imm)); this.pc += 2; break;
      case 0xad: this.setA(this.read(abs)); this.pc += 3; break;
      case 0xbd: this.setA(this.read(abs + this.x)); this.pc += 3; break;
      case 0x85: this.write(imm, this.a); this.pc += 2; break;
      case 0x8d: this.write(abs, this.a); this.pc += 3; break;
      case 0x9d: this.write(abs + this.x, this.a); this.pc += 3; break;
      case 0x29: this.setA(this.a & imm); this.pc += 2; break;
      case 0xa2: this.x = imm; this.z = imm === 0; this.pc += 2; break;
      case 0xe8: this.x = (this.x + 1) & 0xff; this.z = this.x === 0; this.pc += 1; break;
      case 0x48: this.write(0x100 + this.sp--, this.a); this.pc += 1; break;
      case 0x68: this.setA(this.read(0x100 + ++this.sp)); this.pc += 1; break;
      case 0xd0: this.pc = this.z ? this.pc + 2 : branch(); break;
      case 0xf0: this.pc = this.z ? branch() : this.pc + 2; break;
      case 0x6c: this.pc = this.word(abs); break;
      default:
        throw new Error(`opcode $${op.toString(16)} at $${this.pc.toString(16)} is not in this handler`);
    }
  }

  /** Runs until the CPU reaches `stopAt` or `maxSteps` have run; true when it got there. */
  runUntil(stopAt: number, maxSteps: number): boolean {
    for (let i = 0; i < maxSteps; i++) {
      if (this.pc === stopAt) return true;
      this.step();
    }
    return this.pc === stopAt;
  }
}

const install = (machine: MiniC64, armed: boolean) => {
  const { bytes, layout } = buildCharacterRomCopyHandler();
  machine.ram.set(bytes, layout.base);
  machine.ram[layout.origVec] = ORIGINAL_IRQ & 0xff;
  machine.ram[layout.origVec + 1] = ORIGINAL_IRQ >> 8;
  machine.ram[layout.armed] = armed ? 1 : 0;
  machine.ram[0x01] = 0x37;
  machine.pc = layout.base;
  return layout;
};

describe("buildCharacterRomCopyHandler", () => {
  it("fits in the cassette buffer and places its flags where the reader polls them", () => {
    const { bytes, layout } = buildCharacterRomCopyHandler();
    expect(layout).toEqual({
      base: 0x033c,
      buffer: CHARACTER_ROM_COPY_BUFFER,
      armed: 0x03c5,
      done: 0x03c6,
      release: 0x03c7,
      origVec: 0x03c8,
      length: 142,
    });
    expect(layout.done).toBe(layout.armed + 1);
    expect(layout.base + bytes.length).toBeLessThanOrEqual(0x03fc);
    // Clears CHAREN only: LDA $01 / PHA / AND #$FB / STA $01, and restores it with PLA / STA $01.
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
    expect(hex).toContain("a5 01 48 29 fb 85 01");
    expect(hex).toContain("68 85 01 a9 01 8d c6 03");
  });

  it("copies the character ROM into the buffer, puts $01 back, and holds until released", () => {
    const machine = new MiniC64();
    const layout = install(machine, true);

    expect(machine.runUntil(ORIGINAL_IRQ, 100_000)).toBe(false);
    expect(machine.ram[layout.done]).toBe(1);
    expect(machine.ram[layout.armed]).toBe(0);
    expect(machine.ram.slice(layout.buffer, layout.buffer + CHARACTER_ROM_BYTES)).toEqual(machine.chargen);
    expect(machine.portHistory).toEqual([0x33, 0x37]);
    expect(machine.sp).toBe(0xf0);

    machine.ram[layout.release] = 1;
    expect(machine.runUntil(ORIGINAL_IRQ, 10)).toBe(true);
  });

  it("goes straight on to the original handler when not armed", () => {
    const machine = new MiniC64();
    const layout = install(machine, false);

    expect(machine.runUntil(ORIGINAL_IRQ, 3)).toBe(true);
    expect(machine.ram[layout.done]).toBe(0);
    expect(machine.portHistory).toEqual([]);
    expect(machine.ram.slice(layout.buffer, layout.buffer + CHARACTER_ROM_BYTES).every((b) => b === 0)).toBe(true);
  });
});
