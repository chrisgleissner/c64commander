/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * An NMOS 6502 interpreter, for tests that need to run a real C64 program.
 *
 * It exists so `tools/c64/joystick-probe.prg` — the program the hardware harnesses
 * upload to a C64 — can be asserted against in CI, where there is no C64. The
 * committed binary is what runs here, so the test covers the artefact that is
 * actually shipped rather than a description of it.
 *
 * Scope, deliberately: the documented instruction set with every documented
 * addressing mode, and no cycle accounting. Cycles would only matter for code that
 * times itself against the raster, and the probe does not — it waits for a raster
 * VALUE, which {@link C64TestBus} supplies. An undocumented opcode throws with the
 * address it was read from, so a program this cannot run says so instead of
 * wandering off into whatever the bytes happen to decode as.
 */

export interface Mos6502Bus {
  read(address: number): number;
  write(address: number, value: number): void;
}

type Mode = "imp" | "acc" | "imm" | "zp" | "zpx" | "zpy" | "abs" | "absx" | "absy" | "indx" | "indy" | "ind" | "rel";

/** opcode byte → [mnemonic, addressing mode]. Canonical NMOS encodings. */
const OPCODES: Record<number, readonly [string, Mode]> = {
  0x69: ["ADC", "imm"],
  0x65: ["ADC", "zp"],
  0x75: ["ADC", "zpx"],
  0x6d: ["ADC", "abs"],
  0x7d: ["ADC", "absx"],
  0x79: ["ADC", "absy"],
  0x61: ["ADC", "indx"],
  0x71: ["ADC", "indy"],
  0x29: ["AND", "imm"],
  0x25: ["AND", "zp"],
  0x35: ["AND", "zpx"],
  0x2d: ["AND", "abs"],
  0x3d: ["AND", "absx"],
  0x39: ["AND", "absy"],
  0x21: ["AND", "indx"],
  0x31: ["AND", "indy"],
  0x0a: ["ASL", "acc"],
  0x06: ["ASL", "zp"],
  0x16: ["ASL", "zpx"],
  0x0e: ["ASL", "abs"],
  0x1e: ["ASL", "absx"],
  0x90: ["BCC", "rel"],
  0xb0: ["BCS", "rel"],
  0xf0: ["BEQ", "rel"],
  0x24: ["BIT", "zp"],
  0x2c: ["BIT", "abs"],
  0x30: ["BMI", "rel"],
  0xd0: ["BNE", "rel"],
  0x10: ["BPL", "rel"],
  0x50: ["BVC", "rel"],
  0x70: ["BVS", "rel"],
  0x18: ["CLC", "imp"],
  0xd8: ["CLD", "imp"],
  0x58: ["CLI", "imp"],
  0xb8: ["CLV", "imp"],
  0xc9: ["CMP", "imm"],
  0xc5: ["CMP", "zp"],
  0xd5: ["CMP", "zpx"],
  0xcd: ["CMP", "abs"],
  0xdd: ["CMP", "absx"],
  0xd9: ["CMP", "absy"],
  0xc1: ["CMP", "indx"],
  0xd1: ["CMP", "indy"],
  0xe0: ["CPX", "imm"],
  0xe4: ["CPX", "zp"],
  0xec: ["CPX", "abs"],
  0xc0: ["CPY", "imm"],
  0xc4: ["CPY", "zp"],
  0xcc: ["CPY", "abs"],
  0xc6: ["DEC", "zp"],
  0xd6: ["DEC", "zpx"],
  0xce: ["DEC", "abs"],
  0xde: ["DEC", "absx"],
  0xca: ["DEX", "imp"],
  0x88: ["DEY", "imp"],
  0x49: ["EOR", "imm"],
  0x45: ["EOR", "zp"],
  0x55: ["EOR", "zpx"],
  0x4d: ["EOR", "abs"],
  0x5d: ["EOR", "absx"],
  0x59: ["EOR", "absy"],
  0x41: ["EOR", "indx"],
  0x51: ["EOR", "indy"],
  0xe6: ["INC", "zp"],
  0xf6: ["INC", "zpx"],
  0xee: ["INC", "abs"],
  0xfe: ["INC", "absx"],
  0xe8: ["INX", "imp"],
  0xc8: ["INY", "imp"],
  0x4c: ["JMP", "abs"],
  0x6c: ["JMP", "ind"],
  0x20: ["JSR", "abs"],
  0xa9: ["LDA", "imm"],
  0xa5: ["LDA", "zp"],
  0xb5: ["LDA", "zpx"],
  0xad: ["LDA", "abs"],
  0xbd: ["LDA", "absx"],
  0xb9: ["LDA", "absy"],
  0xa1: ["LDA", "indx"],
  0xb1: ["LDA", "indy"],
  0xa2: ["LDX", "imm"],
  0xa6: ["LDX", "zp"],
  0xb6: ["LDX", "zpy"],
  0xae: ["LDX", "abs"],
  0xbe: ["LDX", "absy"],
  0xa0: ["LDY", "imm"],
  0xa4: ["LDY", "zp"],
  0xb4: ["LDY", "zpx"],
  0xac: ["LDY", "abs"],
  0xbc: ["LDY", "absx"],
  0x4a: ["LSR", "acc"],
  0x46: ["LSR", "zp"],
  0x56: ["LSR", "zpx"],
  0x4e: ["LSR", "abs"],
  0x5e: ["LSR", "absx"],
  0xea: ["NOP", "imp"],
  0x09: ["ORA", "imm"],
  0x05: ["ORA", "zp"],
  0x15: ["ORA", "zpx"],
  0x0d: ["ORA", "abs"],
  0x1d: ["ORA", "absx"],
  0x19: ["ORA", "absy"],
  0x01: ["ORA", "indx"],
  0x11: ["ORA", "indy"],
  0x48: ["PHA", "imp"],
  0x08: ["PHP", "imp"],
  0x68: ["PLA", "imp"],
  0x28: ["PLP", "imp"],
  0x2a: ["ROL", "acc"],
  0x26: ["ROL", "zp"],
  0x36: ["ROL", "zpx"],
  0x2e: ["ROL", "abs"],
  0x3e: ["ROL", "absx"],
  0x6a: ["ROR", "acc"],
  0x66: ["ROR", "zp"],
  0x76: ["ROR", "zpx"],
  0x6e: ["ROR", "abs"],
  0x7e: ["ROR", "absx"],
  0x40: ["RTI", "imp"],
  0x60: ["RTS", "imp"],
  0xe9: ["SBC", "imm"],
  0xe5: ["SBC", "zp"],
  0xf5: ["SBC", "zpx"],
  0xed: ["SBC", "abs"],
  0xfd: ["SBC", "absx"],
  0xf9: ["SBC", "absy"],
  0xe1: ["SBC", "indx"],
  0xf1: ["SBC", "indy"],
  0x38: ["SEC", "imp"],
  0xf8: ["SED", "imp"],
  0x78: ["SEI", "imp"],
  0x85: ["STA", "zp"],
  0x95: ["STA", "zpx"],
  0x8d: ["STA", "abs"],
  0x9d: ["STA", "absx"],
  0x99: ["STA", "absy"],
  0x81: ["STA", "indx"],
  0x91: ["STA", "indy"],
  0x86: ["STX", "zp"],
  0x96: ["STX", "zpy"],
  0x8e: ["STX", "abs"],
  0x84: ["STY", "zp"],
  0x94: ["STY", "zpx"],
  0x8c: ["STY", "abs"],
  0xaa: ["TAX", "imp"],
  0xa8: ["TAY", "imp"],
  0xba: ["TSX", "imp"],
  0x8a: ["TXA", "imp"],
  0x9a: ["TXS", "imp"],
  0x98: ["TYA", "imp"],
};

const hex = (value: number, width = 4) => `$${value.toString(16).padStart(width, "0")}`;

export class Mos6502 {
  a = 0;
  x = 0;
  y = 0;
  s = 0xfd;
  pc = 0;
  carry = false;
  zero = false;
  interruptDisable = true;
  decimal = false;
  overflow = false;
  negative = false;

  constructor(private readonly bus: Mos6502Bus) {}

  /** Start execution at `address`, as a `SYS` would. */
  jumpTo(address: number): void {
    this.pc = address & 0xffff;
  }

  private fetch(): number {
    const value = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return value;
  }

  private fetchWord(): number {
    const low = this.fetch();
    return low | (this.fetch() << 8);
  }

  private push(value: number): void {
    this.bus.write(0x0100 | this.s, value & 0xff);
    this.s = (this.s - 1) & 0xff;
  }

  private pull(): number {
    this.s = (this.s + 1) & 0xff;
    return this.bus.read(0x0100 | this.s);
  }

  private get status(): number {
    return (
      (this.carry ? 0x01 : 0) |
      (this.zero ? 0x02 : 0) |
      (this.interruptDisable ? 0x04 : 0) |
      (this.decimal ? 0x08 : 0) |
      0x30 |
      (this.overflow ? 0x40 : 0) |
      (this.negative ? 0x80 : 0)
    );
  }

  private set status(value: number) {
    this.carry = (value & 0x01) !== 0;
    this.zero = (value & 0x02) !== 0;
    this.interruptDisable = (value & 0x04) !== 0;
    this.decimal = (value & 0x08) !== 0;
    this.overflow = (value & 0x40) !== 0;
    this.negative = (value & 0x80) !== 0;
  }

  private setNZ(value: number): number {
    const byte = value & 0xff;
    this.zero = byte === 0;
    this.negative = (byte & 0x80) !== 0;
    return byte;
  }

  /** The effective address for `mode`, or `null` for the modes that have none. */
  private address(mode: Mode): number | null {
    switch (mode) {
      case "imp":
      case "acc":
        return null;
      case "imm": {
        const at = this.pc;
        this.pc = (this.pc + 1) & 0xffff;
        return at;
      }
      case "zp":
        return this.fetch();
      case "zpx":
        return (this.fetch() + this.x) & 0xff;
      case "zpy":
        return (this.fetch() + this.y) & 0xff;
      case "abs":
        return this.fetchWord();
      case "absx":
        return (this.fetchWord() + this.x) & 0xffff;
      case "absy":
        return (this.fetchWord() + this.y) & 0xffff;
      case "indx": {
        const zp = (this.fetch() + this.x) & 0xff;
        return this.bus.read(zp) | (this.bus.read((zp + 1) & 0xff) << 8);
      }
      case "indy": {
        const zp = this.fetch();
        const base = this.bus.read(zp) | (this.bus.read((zp + 1) & 0xff) << 8);
        return (base + this.y) & 0xffff;
      }
      case "ind": {
        const pointer = this.fetchWord();
        // The NMOS indirect-JMP page-wrap bug, reproduced: a vector at $xxFF reads
        // its high byte from $xx00. Anything that relies on the fixed behaviour of
        // later parts would be a program this cannot run, and should say so.
        const high = (pointer & 0xff00) | ((pointer + 1) & 0xff);
        return this.bus.read(pointer) | (this.bus.read(high) << 8);
      }
      case "rel": {
        const offset = this.fetch();
        return (this.pc + (offset < 0x80 ? offset : offset - 0x100)) & 0xffff;
      }
    }
  }

  private branch(target: number, taken: boolean): void {
    if (taken) this.pc = target;
  }

  private compare(register: number, value: number): void {
    const difference = (register - value) & 0x1ff;
    this.carry = register >= value;
    this.setNZ(difference);
  }

  private addWithCarry(value: number): void {
    // Binary mode only: the probe never sets D, and a decimal ADC that silently did
    // the binary thing would be a wrong answer rather than a refusal.
    if (this.decimal) throw new Error("decimal mode is not implemented");
    const sum = this.a + value + (this.carry ? 1 : 0);
    this.carry = sum > 0xff;
    this.overflow = ((this.a ^ sum) & (value ^ sum) & 0x80) !== 0;
    this.a = this.setNZ(sum);
  }

  private shiftLeft(value: number): number {
    this.carry = (value & 0x80) !== 0;
    return this.setNZ(value << 1);
  }

  private shiftRight(value: number): number {
    this.carry = (value & 0x01) !== 0;
    return this.setNZ(value >> 1);
  }

  private rotateLeft(value: number): number {
    const carryIn = this.carry ? 1 : 0;
    this.carry = (value & 0x80) !== 0;
    return this.setNZ((value << 1) | carryIn);
  }

  private rotateRight(value: number): number {
    const carryIn = this.carry ? 0x80 : 0;
    this.carry = (value & 0x01) !== 0;
    return this.setNZ((value >> 1) | carryIn);
  }

  /** Execute one instruction. Throws on an opcode this interpreter does not cover. */
  step(): void {
    const opcodeAddress = this.pc;
    const opcode = this.fetch();
    const decoded = OPCODES[opcode];
    if (!decoded) {
      throw new Error(`unimplemented opcode $${opcode.toString(16).padStart(2, "0")} at ${hex(opcodeAddress)}`);
    }
    const [mnemonic, mode] = decoded;
    const address = this.address(mode);
    const load = () => this.bus.read(address as number);
    const store = (value: number) => this.bus.write(address as number, value & 0xff);
    // Read-modify-write on the accumulator or on memory, chosen by the mode, so the
    // four shifts and rotates each read as one line below.
    const modify = (operation: (value: number) => number) => {
      if (mode === "acc") this.a = operation(this.a);
      else store(operation(load()));
    };

    switch (mnemonic) {
      case "ADC":
        this.addWithCarry(load());
        break;
      case "AND":
        this.a = this.setNZ(this.a & load());
        break;
      case "ASL":
        modify((value) => this.shiftLeft(value));
        break;
      case "BCC":
        this.branch(address as number, !this.carry);
        break;
      case "BCS":
        this.branch(address as number, this.carry);
        break;
      case "BEQ":
        this.branch(address as number, this.zero);
        break;
      case "BIT": {
        const value = load();
        this.zero = (this.a & value) === 0;
        this.overflow = (value & 0x40) !== 0;
        this.negative = (value & 0x80) !== 0;
        break;
      }
      case "BMI":
        this.branch(address as number, this.negative);
        break;
      case "BNE":
        this.branch(address as number, !this.zero);
        break;
      case "BPL":
        this.branch(address as number, !this.negative);
        break;
      case "BVC":
        this.branch(address as number, !this.overflow);
        break;
      case "BVS":
        this.branch(address as number, this.overflow);
        break;
      case "CLC":
        this.carry = false;
        break;
      case "CLD":
        this.decimal = false;
        break;
      case "CLI":
        this.interruptDisable = false;
        break;
      case "CLV":
        this.overflow = false;
        break;
      case "CMP":
        this.compare(this.a, load());
        break;
      case "CPX":
        this.compare(this.x, load());
        break;
      case "CPY":
        this.compare(this.y, load());
        break;
      case "DEC":
        store(this.setNZ(load() - 1));
        break;
      case "DEX":
        this.x = this.setNZ(this.x - 1);
        break;
      case "DEY":
        this.y = this.setNZ(this.y - 1);
        break;
      case "EOR":
        this.a = this.setNZ(this.a ^ load());
        break;
      case "INC":
        store(this.setNZ(load() + 1));
        break;
      case "INX":
        this.x = this.setNZ(this.x + 1);
        break;
      case "INY":
        this.y = this.setNZ(this.y + 1);
        break;
      case "JMP":
        this.pc = address as number;
        break;
      case "JSR": {
        const returnAddress = (this.pc - 1) & 0xffff;
        this.push(returnAddress >> 8);
        this.push(returnAddress & 0xff);
        this.pc = address as number;
        break;
      }
      case "LDA":
        this.a = this.setNZ(load());
        break;
      case "LDX":
        this.x = this.setNZ(load());
        break;
      case "LDY":
        this.y = this.setNZ(load());
        break;
      case "LSR":
        modify((value) => this.shiftRight(value));
        break;
      case "NOP":
        break;
      case "ORA":
        this.a = this.setNZ(this.a | load());
        break;
      case "PHA":
        this.push(this.a);
        break;
      case "PHP":
        this.push(this.status);
        break;
      case "PLA":
        this.a = this.setNZ(this.pull());
        break;
      case "PLP":
        this.status = this.pull();
        break;
      case "ROL":
        modify((value) => this.rotateLeft(value));
        break;
      case "ROR":
        modify((value) => this.rotateRight(value));
        break;
      case "RTI":
        this.status = this.pull();
        this.pc = this.pull() | (this.pull() << 8);
        break;
      case "RTS":
        this.pc = ((this.pull() | (this.pull() << 8)) + 1) & 0xffff;
        break;
      case "SBC":
        this.addWithCarry(load() ^ 0xff);
        break;
      case "SEC":
        this.carry = true;
        break;
      case "SED":
        this.decimal = true;
        break;
      case "SEI":
        this.interruptDisable = true;
        break;
      case "STA":
        store(this.a);
        break;
      case "STX":
        store(this.x);
        break;
      case "STY":
        store(this.y);
        break;
      case "TAX":
        this.x = this.setNZ(this.a);
        break;
      case "TAY":
        this.y = this.setNZ(this.a);
        break;
      case "TSX":
        this.x = this.setNZ(this.s);
        break;
      case "TXA":
        this.a = this.setNZ(this.x);
        break;
      case "TXS":
        this.s = this.x;
        break;
      case "TYA":
        this.a = this.setNZ(this.y);
        break;
      default:
        throw new Error(`unimplemented instruction ${mnemonic} at ${hex(opcodeAddress)}`);
    }
  }
}

/** Joystick lines as the CIA presents them, active HIGH here and inverted on read. */
export interface JoystickState {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  fire?: boolean;
}

const JOYSTICK_BITS: ReadonlyArray<[keyof JoystickState, number]> = [
  ["up", 0x01],
  ["down", 0x02],
  ["left", 0x04],
  ["right", 0x08],
  ["fire", 0x10],
];

export const joystickMask = (state: JoystickState): number =>
  JOYSTICK_BITS.reduce((mask, [name, bit]) => (state[name] ? mask | bit : mask), 0);

const RASTER_LINES = 312; // PAL

/**
 * Enough of a C64 for a program that polls the raster and the joystick.
 *
 * Memory is flat: the probe runs with I/O banked in and never calls the KERNAL, so
 * there is nothing for banking to decide. Two registers are not memory:
 *
 * - `$D012` returns a raster line that ADVANCES ON EVERY READ and wraps at 312. The
 *   probe's frame wait spins on the value rather than on elapsed time, so this makes
 *   one wait exactly one frame with no cycle counting anywhere.
 * - `$DC00` returns the joystick, active low, whatever was written to the port. On
 *   the real machine the joystick's pull-downs win over the keyboard columns the
 *   probe drives high, which is the behaviour the probe is built around.
 */
export class C64TestBus implements Mos6502Bus {
  readonly memory = new Uint8Array(0x10000);
  /** Directions and fire currently held, active HIGH. Set this between frames. */
  joystick = 0;
  /** Completed raster frames since reset — the frame clock the harness counts on. */
  frames = 0;
  private rasterLine = 0;

  read(address: number): number {
    const at = address & 0xffff;
    if (at === 0xd012) {
      this.rasterLine += 1;
      if (this.rasterLine >= RASTER_LINES) {
        this.rasterLine = 0;
        this.frames += 1;
      }
      return this.rasterLine & 0xff;
    }
    if (at === 0xdc00) return ~this.joystick & 0xff;
    // Interrupt control registers read as "nothing pending" once acknowledged.
    if (at === 0xdc0d || at === 0xdd0d) return 0x00;
    return this.memory[at];
  }

  write(address: number, value: number): void {
    this.memory[address & 0xffff] = value & 0xff;
  }
}

export interface LoadedProgram {
  /** Where the image was loaded. */
  loadAddress: number;
  /** The address the BASIC stub's `SYS` points at. */
  sysAddress: number;
}

/**
 * Load a CBM `.prg` and work out where `RUN` would send the machine.
 *
 * The `SYS` target is parsed out of the BASIC stub rather than passed in, which is
 * exactly what the ROM does with `RUN`, so the test starts the program the same way
 * the Ultimate's PRG runner does and cannot start a stale address by hand.
 */
export const loadPrg = (bus: C64TestBus, prg: Uint8Array): LoadedProgram => {
  const loadAddress = prg[0] | (prg[1] << 8);
  bus.memory.set(prg.subarray(2), loadAddress);

  const sysToken = prg.indexOf(0x9e, 2);
  if (sysToken < 0) throw new Error("the program has no BASIC SYS stub");
  let cursor = sysToken + 1;
  while (prg[cursor] === 0x20) cursor += 1;
  let digits = "";
  while (prg[cursor] >= 0x30 && prg[cursor] <= 0x39) {
    digits += String.fromCharCode(prg[cursor]);
    cursor += 1;
  }
  if (digits.length === 0) throw new Error("the BASIC SYS stub has no address");
  return { loadAddress, sysAddress: Number(digits) };
};

/** How many instructions a frame may take before the program is treated as stuck. */
const INSTRUCTIONS_PER_FRAME_LIMIT = 200_000;

/**
 * Run `frames` raster frames of an already-started program.
 *
 * The budget is a runaway guard, not a schedule: the probe's own frame wait is what
 * paces execution, and a program that stopped reading `$D012` would otherwise spin
 * this loop forever with no clue why.
 */
export const runFrames = (cpu: Mos6502, bus: C64TestBus, frames: number): void => {
  const target = bus.frames + frames;
  let budget = frames * INSTRUCTIONS_PER_FRAME_LIMIT;
  while (bus.frames < target) {
    cpu.step();
    budget -= 1;
    if (budget <= 0) {
      throw new Error(`the program stopped advancing the raster after ${bus.frames} frames (pc ${hex(cpu.pc)})`);
    }
  }
};
