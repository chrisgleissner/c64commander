/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  assertValidCpuState,
  decodePFlags,
  encodePFlags,
  fromCpuStateMeta,
  toCpuStateMeta,
  type CpuState,
} from "@/lib/snapshot/cpu/cpuState";
import type { CpuFlags } from "@/lib/snapshot/snapshotTypes";

const ALL_FALSE: CpuFlags = { n: false, v: false, b: false, d: false, i: false, z: false, c: false };
const ALL_TRUE: CpuFlags = { n: true, v: true, b: true, d: true, i: true, z: true, c: true };

describe("decodePFlags", () => {
  it("decodes an all-clear status byte (ignoring unused bit 5)", () => {
    expect(decodePFlags(0x00)).toEqual(ALL_FALSE);
    // Unused bit 5 being set must not change the decoded map.
    expect(decodePFlags(0x20)).toEqual(ALL_FALSE);
  });

  it("decodes an all-set status byte", () => {
    expect(decodePFlags(0xff)).toEqual(ALL_TRUE);
  });

  it("decodes individual flags by bit position", () => {
    expect(decodePFlags(0x80).n).toBe(true); // bit 7
    expect(decodePFlags(0x40).v).toBe(true); // bit 6
    expect(decodePFlags(0x10).b).toBe(true); // bit 4
    expect(decodePFlags(0x08).d).toBe(true); // bit 3
    expect(decodePFlags(0x04).i).toBe(true); // bit 2
    expect(decodePFlags(0x02).z).toBe(true); // bit 1
    expect(decodePFlags(0x01).c).toBe(true); // bit 0
  });
});

describe("encodePFlags", () => {
  it("always sets the unused bit 5", () => {
    expect(encodePFlags(ALL_FALSE)).toBe(0x20);
  });

  it("encodes all flags", () => {
    expect(encodePFlags(ALL_TRUE)).toBe(0xff);
  });

  it("round-trips every status byte (modulo the forced unused bit)", () => {
    for (let p = 0; p <= 0xff; p++) {
      expect(encodePFlags(decodePFlags(p))).toBe(p | 0x20);
    }
  });
});

describe("toCpuStateMeta / fromCpuStateMeta", () => {
  const STATE: CpuState = { pc: 0xc000, a: 0x12, x: 0x34, y: 0x56, sp: 0xf8, p: 0b1010_0001 };

  it("converts a raw state to metadata with decoded flags", () => {
    const meta = toCpuStateMeta(STATE);
    expect(meta).toMatchObject({ pc: 0xc000, a: 0x12, x: 0x34, y: 0x56, sp: 0xf8, p: 0b1010_0001 });
    expect(meta.flags).toEqual(decodePFlags(STATE.p));
  });

  it("round-trips state -> meta -> state", () => {
    expect(fromCpuStateMeta(toCpuStateMeta(STATE))).toEqual(STATE);
  });
});

describe("assertValidCpuState", () => {
  it("accepts in-range registers", () => {
    expect(() => assertValidCpuState({ pc: 0xffff, a: 0xff, x: 0, y: 0, sp: 0xff, p: 0xff })).not.toThrow();
  });

  it.each([
    ["pc", { pc: 0x10000, a: 0, x: 0, y: 0, sp: 0, p: 0 }],
    ["a", { pc: 0, a: 0x100, x: 0, y: 0, sp: 0, p: 0 }],
    ["sp", { pc: 0, a: 0, x: 0, y: 0, sp: -1, p: 0 }],
    ["p", { pc: 0, a: 0, x: 0, y: 0, sp: 0, p: 1.5 }],
  ])("throws on out-of-range %s", (name, state) => {
    expect(() => assertValidCpuState(state as CpuState)).toThrow(new RegExp(name));
  });
});
