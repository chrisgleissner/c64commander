/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  captureCpuState,
  CpuCaptureFailedError,
  IRQ_VECTOR_0314,
  resumeAfterCapture,
  type CaptureCpuApi,
} from "@/lib/snapshot/cpu/captureEngine";

const parse = (hex: string) => parseInt(hex, 16);

// Scratch/flag layout for the default safe region $033C (see capturePayload).
const L = {
  base: 0x033c,
  scrPcl: 0x0382,
  scrPch: 0x0383,
  scrA: 0x0384,
  scrX: 0x0385,
  scrY: 0x0386,
  scrSp: 0x0387,
  scrP: 0x0388,
  captured: 0x038a,
  release: 0x038b,
};

const ORIG_IRQ = [0x31, 0xea]; // $EA31

/** A tiny RAM model that fires a simulated IRQ on resume, populating the scratch block. */
class CaptureMock {
  mem = new Map<number, number>();
  writeLog: Array<{ addr: number; bytes: number[] }> = [];
  fireOnResume = true;
  capturedFrame = { pcl: 0x00, pch: 0xc0, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 };

  constructor() {
    this.mem.set(0x01, 0x37); // banking
    this.mem.set(0x0314, ORIG_IRQ[0]!);
    this.mem.set(0x0315, ORIG_IRQ[1]!);
    // Pre-fill the cassette buffer with a recognizable "original" pattern.
    for (let i = 0; i < 82; i++) this.mem.set(0x033c + i, 0xa0 + (i & 0x0f));
  }

  private read(addr: number) {
    return this.mem.get(addr) ?? 0x00;
  }

  fireIrq() {
    this.mem.set(L.scrPcl, this.capturedFrame.pcl);
    this.mem.set(L.scrPch, this.capturedFrame.pch);
    this.mem.set(L.scrA, this.capturedFrame.a);
    this.mem.set(L.scrX, this.capturedFrame.x);
    this.mem.set(L.scrY, this.capturedFrame.y);
    this.mem.set(L.scrSp, this.capturedFrame.sp);
    this.mem.set(L.scrP, this.capturedFrame.p);
    this.mem.set(L.captured, 0x01);
  }

  api: CaptureCpuApi = {
    machinePause: async () => ({ errors: [] }),
    machineResume: async () => {
      if (this.fireOnResume) this.fireIrq();
      return { errors: [] };
    },
    readMemory: async (address: string, length = 1) => {
      const start = parse(address);
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = this.read(start + i);
      return out;
    },
    writeMemoryBlock: async (address: string, data: Uint8Array) => {
      const start = parse(address);
      this.writeLog.push({ addr: start, bytes: Array.from(data) });
      data.forEach((b, i) => this.mem.set(start + i, b));
      return { errors: [] };
    },
  };
}

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};

describe("captureCpuState (RLI)", () => {
  it("installs the handler, hooks $0314, and captures the live register frame", async () => {
    const fw = new CaptureMock();
    const result = await captureCpuState(fw.api, clock());

    expect(result.method).toBe("rli");
    expect(result.cpu).toEqual({ pc: 0xc000, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 });
    expect(result.bank01).toBe(0x37);

    // The IRQ vector was repointed at the handler base $033C…
    expect(fw.mem.get(0x0314)).toBe(0x3c);
    expect(fw.mem.get(0x0315)).toBe(0x03);
    // …and the handler's first byte (LDA armed → $AD) was installed at $033C.
    expect(fw.mem.get(0x033c)).toBe(0xad);
  });

  it("records overlays with the original IRQ vector and safe-region bytes", async () => {
    const fw = new CaptureMock();
    const result = await captureCpuState(fw.api, clock());

    const irq = result.overlays.find((o) => o.start === IRQ_VECTOR_0314);
    expect(Array.from(irq!.bytes)).toEqual(ORIG_IRQ);

    const region = result.overlays.find((o) => o.start === L.base);
    expect(region!.bytes.length).toBe(82);
    expect(region!.bytes[0]).toBe(0xa0); // the original pattern, not our handler
  });

  it("rolls back the hook and throws when no interrupt fires (SEI loop)", async () => {
    const fw = new CaptureMock();
    fw.fireOnResume = false;

    await expect(captureCpuState(fw.api, { ...clock(), captureTimeoutMs: 300 })).rejects.toBeInstanceOf(
      CpuCaptureFailedError,
    );
    // The original IRQ vector and safe region were restored.
    expect(fw.mem.get(0x0314)).toBe(ORIG_IRQ[0]);
    expect(fw.mem.get(0x0315)).toBe(ORIG_IRQ[1]);
    expect(fw.mem.get(0x033c)).toBe(0xa0);
  });
});

describe("resumeAfterCapture", () => {
  it("restores the vector, releases the spin loop, and restores the safe region", async () => {
    const fw = new CaptureMock();
    const result = await captureCpuState(fw.api, clock());

    fw.writeLog.length = 0; // only inspect writes issued by resumeAfterCapture
    await resumeAfterCapture(fw.api, result);

    expect(fw.mem.get(0x0314)).toBe(ORIG_IRQ[0]); // vector restored
    expect(fw.mem.get(0x0315)).toBe(ORIG_IRQ[1]);
    expect(fw.mem.get(0x033c)).toBe(0xa0); // safe region restored (overwrites the transient flags)

    // The release flag was written =1, and BEFORE the safe-region restore (so the
    // handler exits its spin before $033C is overwritten).
    const releaseIdx = fw.writeLog.findIndex((w) => w.addr === L.release && w.bytes[0] === 0x01);
    const regionIdx = fw.writeLog.findIndex((w) => w.addr === L.base && w.bytes.length === 82);
    expect(releaseIdx).toBeGreaterThanOrEqual(0);
    expect(regionIdx).toBeGreaterThan(releaseIdx);
  });
});
