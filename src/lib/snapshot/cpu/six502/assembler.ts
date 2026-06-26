/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A deliberately tiny two-pass NMOS 6502 assembler.
 *
 * This is *not* a general-purpose assembler — it covers exactly the opcode /
 * addressing-mode subset used by the snapshot CPU-state payloads (the restore
 * finalize stub and the capture handler), and nothing more. Keeping it small,
 * pure, and fully golden-byte tested is the point: each payload reads like
 * assembly in TypeScript, and every emitted byte is pinned by a unit test
 * against the canonical 6502 opcode values, so a mistyped immediate or a wrong
 * branch offset is caught long before any byte reaches a real device.
 *
 * Programs are expressed as an array of {@link Stmt} built with the helper
 * constructors below, e.g.:
 *
 *   assemble([
 *     sei(),
 *     lda.imm(0x37),
 *     sta.zp(0x01),
 *     label("spin"),
 *     lda.abs(RELEASE_FLAG),
 *     bne("spin"),
 *     rti(),
 *   ], 0x8000)
 *
 * Two passes: pass 1 assigns an address to every statement (instruction size is
 * fixed by addressing mode) and records label addresses; pass 2 emits bytes and
 * resolves label references (absolute → 16-bit little-endian, relative → signed
 * 8-bit displacement). Out-of-range operands, branch-too-far, unknown labels,
 * and unsupported mnemonic/mode pairs all throw — there is no silent truncation.
 */

/** The 6502 addressing modes this assembler understands. */
export type AddrMode =
  | "imp" // implied / accumulator (1 byte)
  | "imm" // immediate #$nn (2 bytes)
  | "zp" // zero page $nn (2 bytes)
  | "zpx" // zero page,X $nn,X (2 bytes)
  | "zpy" // zero page,Y $nn,Y (2 bytes)
  | "abs" // absolute $nnnn (3 bytes)
  | "absx" // absolute,X $nnnn,X (3 bytes)
  | "absy" // absolute,Y $nnnn,Y (3 bytes)
  | "ind" // indirect ($nnnn) — JMP only (3 bytes)
  | "rel"; // relative branch (2 bytes)

/** A label/immediate/address reference. A `string` is a label; a `number` is a literal. */
export type Operand = number | string;

export type Stmt =
  | { t: "label"; name: string }
  | { t: "op"; mnemonic: string; mode: AddrMode; operand: Operand | null }
  | { t: "db"; bytes: number[] }
  | { t: "dw"; value: Operand }
  | { t: "org"; addr: number };

/** Result of assembling a program: the emitted image plus the resolved symbol table. */
export type AssembleResult = {
  /** The assembled machine-code bytes. */
  bytes: Uint8Array;
  /** label name → absolute address. */
  symbols: Record<string, number>;
  /** The origin (load address) the program was assembled at. */
  origin: number;
};

// ---------------------------------------------------------------------------
// Opcode table — `"MNEMONIC mode"` → opcode byte.
// Canonical NMOS 6502 encodings (verified against the standard opcode matrix).
// ---------------------------------------------------------------------------

const OPCODES: Record<string, number> = {
  // --- implied -------------------------------------------------------------
  "BRK imp": 0x00,
  "RTI imp": 0x40,
  "RTS imp": 0x60,
  "NOP imp": 0xea,
  "SEI imp": 0x78,
  "CLI imp": 0x58,
  "CLC imp": 0x18,
  "SEC imp": 0x38,
  "CLD imp": 0xd8,
  "SED imp": 0xf8,
  "CLV imp": 0xb8,
  "TAX imp": 0xaa,
  "TXA imp": 0x8a,
  "TAY imp": 0xa8,
  "TYA imp": 0x98,
  "TSX imp": 0xba,
  "TXS imp": 0x9a,
  "PHA imp": 0x48,
  "PLA imp": 0x68,
  "PHP imp": 0x08,
  "PLP imp": 0x28,
  "INX imp": 0xe8,
  "INY imp": 0xc8,
  "DEX imp": 0xca,
  "DEY imp": 0x88,

  // --- immediate -----------------------------------------------------------
  "LDA imm": 0xa9,
  "LDX imm": 0xa2,
  "LDY imm": 0xa0,
  "CMP imm": 0xc9,
  "CPX imm": 0xe0,
  "CPY imm": 0xc0,
  "AND imm": 0x29,
  "ORA imm": 0x09,
  "EOR imm": 0x49,
  "ADC imm": 0x69,
  "SBC imm": 0xe9,

  // --- zero page -----------------------------------------------------------
  "LDA zp": 0xa5,
  "STA zp": 0x85,
  "LDX zp": 0xa6,
  "STX zp": 0x86,
  "LDY zp": 0xa4,
  "STY zp": 0x84,
  "CMP zp": 0xc5,
  "INC zp": 0xe6,
  "DEC zp": 0xc6,
  "AND zp": 0x25,
  "ORA zp": 0x05,
  "EOR zp": 0x45,
  "ADC zp": 0x65,

  // --- zero page,X ---------------------------------------------------------
  "LDA zpx": 0xb5,
  "STA zpx": 0x95,
  "LDY zpx": 0xb4,
  "STY zpx": 0x94,

  // --- zero page,Y ---------------------------------------------------------
  "LDX zpy": 0xb6,
  "STX zpy": 0x96,

  // --- absolute ------------------------------------------------------------
  "LDA abs": 0xad,
  "STA abs": 0x8d,
  "LDX abs": 0xae,
  "STX abs": 0x8e,
  "LDY abs": 0xac,
  "STY abs": 0x8c,
  "CMP abs": 0xcd,
  "INC abs": 0xee,
  "DEC abs": 0xce,
  "JMP abs": 0x4c,
  "JSR abs": 0x20,
  "AND abs": 0x2d,
  "ORA abs": 0x0d,
  "EOR abs": 0x4d,
  "ADC abs": 0x6d,
  "BIT abs": 0x2c,

  // --- absolute,X ----------------------------------------------------------
  "LDA absx": 0xbd,
  "STA absx": 0x9d,
  "CMP absx": 0xdd,
  "INC absx": 0xfe,
  "DEC absx": 0xde,
  "LDY absx": 0xbc,

  // --- absolute,Y ----------------------------------------------------------
  "LDA absy": 0xb9,
  "STA absy": 0x99,
  "LDX absy": 0xbe,

  // --- indirect (JMP only) -------------------------------------------------
  "JMP ind": 0x6c,

  // --- relative branches ---------------------------------------------------
  "BNE rel": 0xd0,
  "BEQ rel": 0xf0,
  "BPL rel": 0x10,
  "BMI rel": 0x30,
  "BCC rel": 0x90,
  "BCS rel": 0xb0,
  "BVC rel": 0x50,
  "BVS rel": 0x70,
};

/** Byte length of an instruction in a given addressing mode. */
const MODE_SIZE: Record<AddrMode, number> = {
  imp: 1,
  imm: 2,
  zp: 2,
  zpx: 2,
  zpy: 2,
  abs: 3,
  absx: 3,
  absy: 3,
  ind: 3,
  rel: 2,
};

const isByteMode = (mode: AddrMode): boolean => mode === "imm" || mode === "zp" || mode === "zpx" || mode === "zpy";

// ---------------------------------------------------------------------------
// Statement constructors
// ---------------------------------------------------------------------------

export const label = (name: string): Stmt => ({ t: "label", name });
export const db = (...bytes: number[]): Stmt => ({ t: "db", bytes });
/** Emit a 16-bit little-endian word (a literal or a resolved label address). */
export const dw = (value: Operand): Stmt => ({ t: "dw", value });
export const org = (addr: number): Stmt => ({ t: "org", addr });

const make = (mnemonic: string, mode: AddrMode, operand: Operand | null = null): Stmt => ({
  t: "op",
  mnemonic,
  mode,
  operand,
});

/** Implied / accumulator instructions. */
export const sei = (): Stmt => make("SEI", "imp");
export const cli = (): Stmt => make("CLI", "imp");
export const clc = (): Stmt => make("CLC", "imp");
export const sec = (): Stmt => make("SEC", "imp");
export const cld = (): Stmt => make("CLD", "imp");
export const sed = (): Stmt => make("SED", "imp");
export const clv = (): Stmt => make("CLV", "imp");
export const tax = (): Stmt => make("TAX", "imp");
export const txa = (): Stmt => make("TXA", "imp");
export const tay = (): Stmt => make("TAY", "imp");
export const tya = (): Stmt => make("TYA", "imp");
export const tsx = (): Stmt => make("TSX", "imp");
export const txs = (): Stmt => make("TXS", "imp");
export const pha = (): Stmt => make("PHA", "imp");
export const pla = (): Stmt => make("PLA", "imp");
export const php = (): Stmt => make("PHP", "imp");
export const plp = (): Stmt => make("PLP", "imp");
export const inx = (): Stmt => make("INX", "imp");
export const iny = (): Stmt => make("INY", "imp");
export const dex = (): Stmt => make("DEX", "imp");
export const dey = (): Stmt => make("DEY", "imp");
export const nop = (): Stmt => make("NOP", "imp");
export const brk = (): Stmt => make("BRK", "imp");
export const rti = (): Stmt => make("RTI", "imp");
export const rts = (): Stmt => make("RTS", "imp");

/** Builds a per-mnemonic object exposing the addressing modes it supports. */
const modal = (mnemonic: string, modes: AddrMode[]) => {
  const obj: Partial<Record<AddrMode, (operand: Operand) => Stmt>> = {};
  for (const mode of modes) {
    obj[mode] = (operand: Operand) => make(mnemonic, mode, operand);
  }
  return obj as Record<(typeof modes)[number], (operand: Operand) => Stmt>;
};

export const lda = modal("LDA", ["imm", "zp", "zpx", "abs", "absx", "absy"]);
export const ldx = modal("LDX", ["imm", "zp", "zpy", "abs", "absy"]);
export const ldy = modal("LDY", ["imm", "zp", "zpx", "abs", "absx"]);
export const sta = modal("STA", ["zp", "zpx", "abs", "absx", "absy"]);
export const stx = modal("STX", ["zp", "zpy", "abs"]);
export const sty = modal("STY", ["zp", "zpx", "abs"]);
export const cmp = modal("CMP", ["imm", "zp", "abs", "absx"]);
export const cpx = modal("CPX", ["imm"]);
export const cpy = modal("CPY", ["imm"]);
export const and = modal("AND", ["imm", "zp", "abs"]);
export const ora = modal("ORA", ["imm", "zp", "abs"]);
export const eor = modal("EOR", ["imm", "zp", "abs"]);
export const adc = modal("ADC", ["imm", "zp", "abs"]);
export const sbc = modal("SBC", ["imm"]);
export const inc = modal("INC", ["zp", "abs", "absx"]);
export const dec = modal("DEC", ["zp", "abs", "absx"]);
export const bit = modal("BIT", ["abs"]);

export const jmp = {
  abs: (operand: Operand) => make("JMP", "abs", operand),
  ind: (operand: Operand) => make("JMP", "ind", operand),
};
export const jsr = (operand: Operand): Stmt => make("JSR", "abs", operand);

export const bne = (operand: Operand): Stmt => make("BNE", "rel", operand);
export const beq = (operand: Operand): Stmt => make("BEQ", "rel", operand);
export const bpl = (operand: Operand): Stmt => make("BPL", "rel", operand);
export const bmi = (operand: Operand): Stmt => make("BMI", "rel", operand);
export const bcc = (operand: Operand): Stmt => make("BCC", "rel", operand);
export const bcs = (operand: Operand): Stmt => make("BCS", "rel", operand);
export const bvc = (operand: Operand): Stmt => make("BVC", "rel", operand);
export const bvs = (operand: Operand): Stmt => make("BVS", "rel", operand);

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

const stmtSize = (stmt: Stmt): number => {
  switch (stmt.t) {
    case "label":
    case "org":
      return 0;
    case "db":
      return stmt.bytes.length;
    case "dw":
      return 2;
    case "op":
      return MODE_SIZE[stmt.mode];
  }
};

/**
 * Assembles a program at `origin`. Returns the emitted bytes and the resolved
 * symbol table. Throws on any inconsistency (unknown mnemonic/mode, duplicate
 * or undefined label, operand out of range, branch out of reach).
 */
export const assemble = (program: Stmt[], origin: number): AssembleResult => {
  if (!Number.isInteger(origin) || origin < 0 || origin > 0xffff) {
    throw new Error(`assemble: origin out of range: ${origin}`);
  }

  // --- Pass 1: assign addresses and collect labels -------------------------
  const symbols: Record<string, number> = {};
  let pc = origin;
  for (const stmt of program) {
    if (stmt.t === "org") {
      if (stmt.addr < pc) {
        throw new Error(`assemble: .org $${stmt.addr.toString(16)} moves backwards from $${pc.toString(16)}`);
      }
      pc = stmt.addr;
      continue;
    }
    if (stmt.t === "label") {
      if (stmt.name in symbols) {
        throw new Error(`assemble: duplicate label "${stmt.name}"`);
      }
      symbols[stmt.name] = pc;
      continue;
    }
    pc += stmtSize(stmt);
    if (pc > 0x10000) {
      throw new Error(`assemble: program overruns the 64 KiB address space`);
    }
  }

  // --- Pass 2: emit bytes --------------------------------------------------
  const out: number[] = [];
  pc = origin;
  const padTo = (addr: number) => {
    while (origin + out.length < addr) out.push(0x00);
  };

  const resolve = (operand: Operand): number => {
    if (typeof operand === "number") return operand;
    if (!(operand in symbols)) throw new Error(`assemble: undefined label "${operand}"`);
    return symbols[operand]!;
  };

  for (const stmt of program) {
    if (stmt.t === "org") {
      padTo(stmt.addr);
      pc = stmt.addr;
      continue;
    }
    if (stmt.t === "label") continue;
    if (stmt.t === "db") {
      for (const b of stmt.bytes) {
        if (!Number.isInteger(b) || b < 0 || b > 0xff) throw new Error(`assemble: .db byte out of range: ${b}`);
        out.push(b);
      }
      pc += stmt.bytes.length;
      continue;
    }
    if (stmt.t === "dw") {
      const value = resolve(stmt.value);
      if (value < 0 || value > 0xffff) throw new Error(`assemble: .dw value out of range: ${value}`);
      out.push(value & 0xff);
      out.push((value >> 8) & 0xff);
      pc += 2;
      continue;
    }

    const opcode = OPCODES[`${stmt.mnemonic} ${stmt.mode}`];
    if (opcode === undefined) {
      throw new Error(`assemble: no opcode for ${stmt.mnemonic} (${stmt.mode})`);
    }
    out.push(opcode);

    if (stmt.mode === "imp") {
      pc += 1;
      continue;
    }

    if (stmt.operand == null) {
      throw new Error(`assemble: ${stmt.mnemonic} (${stmt.mode}) requires an operand`);
    }

    if (stmt.mode === "rel") {
      const target = resolve(stmt.operand);
      const next = pc + 2; // address of the instruction after the branch
      const delta = target - next;
      if (delta < -128 || delta > 127) {
        throw new Error(
          `assemble: branch out of range (${delta}) from $${pc.toString(16)} to $${target.toString(16)}`,
        );
      }
      out.push(delta & 0xff);
      pc += 2;
      continue;
    }

    const value = resolve(stmt.operand);
    if (isByteMode(stmt.mode)) {
      if (value < 0 || value > 0xff) throw new Error(`assemble: 8-bit operand out of range: ${value}`);
      out.push(value & 0xff);
      pc += 2;
    } else {
      if (value < 0 || value > 0xffff) throw new Error(`assemble: 16-bit operand out of range: ${value}`);
      out.push(value & 0xff); // low byte first (little-endian)
      out.push((value >> 8) & 0xff);
      pc += 3;
    }
  }

  return { bytes: Uint8Array.from(out), symbols, origin };
};
