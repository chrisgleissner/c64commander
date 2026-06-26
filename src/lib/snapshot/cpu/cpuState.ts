/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { CpuFlags, CpuStateMeta } from "../snapshotTypes";

/**
 * The raw captured 6510 CPU register file. This is the working representation
 * used by the capture/restore engines; {@link toCpuStateMeta} converts it to the
 * snapshot-metadata shape (which additionally carries a decoded flag map).
 */
export type CpuState = {
  /** Program counter (0x0000–0xFFFF). */
  pc: number;
  /** Accumulator (0x00–0xFF). */
  a: number;
  /** X index (0x00–0xFF). */
  x: number;
  /** Y index (0x00–0xFF). */
  y: number;
  /** Stack pointer (0x00–0xFF). */
  sp: number;
  /** Raw processor-status byte (N V - B D I Z C). */
  p: number;
};

/** Bit positions of each meaningful flag within the 6502 P register. */
export const P_FLAG_BITS = {
  n: 7, // negative
  v: 6, // overflow
  b: 4, // break
  d: 3, // decimal
  i: 2, // interrupt disable
  z: 1, // zero
  c: 0, // carry
} as const satisfies Record<keyof CpuFlags, number>;

/** Bit 5 of P is unused on the 6502 and reads as 1; we preserve it on the raw byte. */
export const P_UNUSED_BIT = 5;

const u8 = (value: number): number => value & 0xff;
const u16 = (value: number): number => value & 0xffff;

/** Decodes a raw P status byte into its boolean flag map (unused bit 5 omitted). */
export const decodePFlags = (p: number): CpuFlags => {
  const raw = u8(p);
  return {
    n: ((raw >> P_FLAG_BITS.n) & 1) === 1,
    v: ((raw >> P_FLAG_BITS.v) & 1) === 1,
    b: ((raw >> P_FLAG_BITS.b) & 1) === 1,
    d: ((raw >> P_FLAG_BITS.d) & 1) === 1,
    i: ((raw >> P_FLAG_BITS.i) & 1) === 1,
    z: ((raw >> P_FLAG_BITS.z) & 1) === 1,
    c: ((raw >> P_FLAG_BITS.c) & 1) === 1,
  };
};

/**
 * Encodes a flag map back into a raw P byte. The unused bit 5 is forced to 1 to
 * match how a real 6502 presents the status register.
 */
export const encodePFlags = (flags: CpuFlags): number => {
  let raw = 1 << P_UNUSED_BIT;
  if (flags.n) raw |= 1 << P_FLAG_BITS.n;
  if (flags.v) raw |= 1 << P_FLAG_BITS.v;
  if (flags.b) raw |= 1 << P_FLAG_BITS.b;
  if (flags.d) raw |= 1 << P_FLAG_BITS.d;
  if (flags.i) raw |= 1 << P_FLAG_BITS.i;
  if (flags.z) raw |= 1 << P_FLAG_BITS.z;
  if (flags.c) raw |= 1 << P_FLAG_BITS.c;
  return u8(raw);
};

/**
 * Validates register bounds. Throws on an out-of-range value so a malformed
 * capture can never be silently serialized into a snapshot.
 */
export const assertValidCpuState = (state: CpuState): void => {
  const checks: Array<[string, number, number]> = [
    ["pc", state.pc, 0xffff],
    ["a", state.a, 0xff],
    ["x", state.x, 0xff],
    ["y", state.y, 0xff],
    ["sp", state.sp, 0xff],
    ["p", state.p, 0xff],
  ];
  for (const [name, value, max] of checks) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(`Invalid CpuState.${name}: ${value} (expected integer 0–${max})`);
    }
  }
};

/** Converts a raw {@link CpuState} into the snapshot-metadata shape (adds decoded flags). */
export const toCpuStateMeta = (state: CpuState): CpuStateMeta => {
  assertValidCpuState(state);
  return {
    pc: u16(state.pc),
    a: u8(state.a),
    x: u8(state.x),
    y: u8(state.y),
    sp: u8(state.sp),
    p: u8(state.p),
    flags: decodePFlags(state.p),
  };
};

/** Converts snapshot metadata back into a raw {@link CpuState}. */
export const fromCpuStateMeta = (meta: CpuStateMeta): CpuState => {
  const state: CpuState = {
    pc: u16(meta.pc),
    a: u8(meta.a),
    x: u8(meta.x),
    y: u8(meta.y),
    sp: u8(meta.sp),
    p: u8(meta.p),
  };
  assertValidCpuState(state);
  return state;
};
