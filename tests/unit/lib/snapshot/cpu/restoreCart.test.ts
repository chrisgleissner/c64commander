/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  CpuRestoreUnsupportedError,
  readByteFromRanges,
  restoreCpuSnapshot,
  type CpuRestoreRange,
  type RestoreCpuApi,
} from "@/lib/snapshot/cpu/restoreCart";
import { validateFileBytes } from "@/lib/fileValidation";
import type { CpuState } from "@/lib/snapshot/cpu/cpuState";

type WriteCall = { address: number; bytes: number[] };

class MockFirmware {
  crtUploads: Uint8Array[] = [];
  writes: WriteCall[] = [];
  readAddresses: number[] = [];

  api: RestoreCpuApi = {
    runCartridgeUpload: async (crt: Blob) => {
      this.crtUploads.push(new Uint8Array(await crt.arrayBuffer()));
      return { errors: [] };
    },
    readMemory: async (address: string) => {
      this.readAddresses.push(parseInt(address, 16));
      // The cart is always "spinning": $02 reads back READY ($A5).
      return new Uint8Array([0xa5]);
    },
    writeMemoryBlock: async (address: string, data: Uint8Array) => {
      this.writes.push({ address: parseInt(address, 16), bytes: Array.from(data) });
      return { errors: [] };
    },
  };

  /** Every absolute address touched by a writeMemoryBlock call. */
  writtenAddresses(): Set<number> {
    const s = new Set<number>();
    for (const w of this.writes) for (let i = 0; i < w.bytes.length; i++) s.add(w.address + i);
    return s;
  }
}

const CPU: CpuState = { pc: 0xc000, a: 0x12, x: 0x34, y: 0x56, sp: 0xf0, p: 0xa5 };

const fullRamRange = (): CpuRestoreRange => {
  const bytes = new Uint8Array(0x10000);
  bytes[0x01] = 0x37; // banking
  bytes[0x02] = 0x99; // handshake byte snapshot value
  return { start: 0x0000, bytes };
};

/** A deterministic clock that advances on each (no-op) sleep, so timeouts terminate. */
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};

describe("restoreCpuSnapshot — sequencing", () => {
  it("uploads a valid CRT, waits for READY, DMAs RAM, then releases last", async () => {
    const fw = new MockFirmware();
    const result = await restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock());

    expect(result.ok).toBe(true);
    // CRT uploaded exactly once and is structurally valid.
    expect(fw.crtUploads).toHaveLength(1);
    expect(validateFileBytes(fw.crtUploads[0]!, "crt").ok).toBe(true);
    // It polled the handshake byte $02.
    expect(fw.readAddresses).toContain(0x02);
    // The very last write is the release: $02 = $5A (GO).
    const last = fw.writes.at(-1)!;
    expect(last.address).toBe(0x02);
    expect(last.bytes).toEqual([0x5a]);
  });

  it("plants the RTI frame (P, PCL, PCH) just below the saved SP", async () => {
    const fw = new MockFirmware();
    const { rtiFrameAddress } = await restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock());
    // SP=$F0 → frame at $0100+$F0-2 = $01EE
    expect(rtiFrameAddress).toBe(0x01ee);
    const frame = fw.writes.find((w) => w.address === 0x01ee);
    expect(frame?.bytes).toEqual([0xa5, 0x00, 0xc0]); // P, PCL($00), PCH($C0)
  });
});

describe("restoreCpuSnapshot — never corrupts volatile / handshake bytes", () => {
  it("never writes the CIA timer registers during the bulk RAM restore", async () => {
    const fw = new MockFirmware();
    await restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock());
    const written = fw.writtenAddresses();
    for (const base of [0xdc00, 0xdd00]) {
      for (let reg = 0x04; reg <= 0x07; reg++) {
        expect(written.has(base + reg)).toBe(false);
        expect(written.has(base + 0x10 + reg)).toBe(false); // mirror
      }
    }
  });

  it("never writes $02 during the bulk RAM restore (only the final release)", async () => {
    const fw = new MockFirmware();
    await restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock());
    const writesTo02 = fw.writes.filter((w) => w.address <= 0x02 && 0x02 < w.address + w.bytes.length);
    // Exactly one write touches $02, and it is the single-byte release.
    expect(writesTo02).toHaveLength(1);
    expect(writesTo02[0]).toEqual({ address: 0x02, bytes: [0x5a] });
  });
});

describe("restoreCpuSnapshot — refuses unsupported snapshots", () => {
  it("refuses when the stack pointer is too low for the free-stack layout", async () => {
    const fw = new MockFirmware();
    await expect(
      restoreCpuSnapshot(fw.api, { cpu: { ...CPU, sp: 0x05 }, ramRanges: [fullRamRange()] }, clock()),
    ).rejects.toBeInstanceOf(CpuRestoreUnsupportedError);
    expect(fw.crtUploads).toHaveLength(0); // nothing was uploaded
  });

  it("refuses when the snapshot omits $01 (banking)", async () => {
    const fw = new MockFirmware();
    const noByte01: CpuRestoreRange = { start: 0x0200, bytes: new Uint8Array(0x10) };
    await expect(restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [noByte01] }, clock())).rejects.toBeInstanceOf(
      CpuRestoreUnsupportedError,
    );
  });

  it("throws (not Unsupported) when the cart never signals READY", async () => {
    const fw = new MockFirmware();
    fw.api.readMemory = async () => new Uint8Array([0x00]); // never READY
    await expect(restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock())).rejects.toThrow(
      /did not reach its handshake/,
    );
  });
});

describe("restoreCpuSnapshot — transport retries (fragile firmware)", () => {
  it("retries a writemem that returns an error array, then succeeds", async () => {
    const fw = new MockFirmware();
    let calls = 0;
    fw.api.writeMemoryBlock = async (address: string, data: Uint8Array) => {
      calls += 1;
      if (calls <= 2) return { errors: ["device busy"] };
      fw.writes.push({ address: parseInt(address, 16), bytes: Array.from(data) });
      return { errors: [] };
    };

    const result = await restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock());
    expect(result.ok).toBe(true);
    expect(calls).toBeGreaterThan(3); // first call retried twice before succeeding
  });

  it("gives up and throws after exhausting writemem retries", async () => {
    const fw = new MockFirmware();
    fw.api.writeMemoryBlock = async () => {
      throw new Error("connection reset by peer");
    };

    await expect(restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock())).rejects.toThrow(
      "connection reset by peer",
    );
  });

  it("retries a transient readmem failure while polling for READY", async () => {
    const fw = new MockFirmware();
    let reads = 0;
    fw.api.readMemory = async () => {
      reads += 1;
      if (reads === 1) throw new Error("transient 404");
      return new Uint8Array([0xa5]); // READY thereafter
    };

    const result = await restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock());
    expect(result.ok).toBe(true);
    expect(reads).toBeGreaterThan(1);
  });

  it("throws when readmem keeps failing during the READY handshake", async () => {
    const fw = new MockFirmware();
    fw.api.readMemory = async () => {
      throw new Error("socket dead");
    };

    await expect(restoreCpuSnapshot(fw.api, { cpu: CPU, ramRanges: [fullRamRange()] }, clock())).rejects.toThrow(
      "socket dead",
    );
  });
});

describe("readByteFromRanges", () => {
  it("reads a byte covered by a range and returns undefined otherwise", () => {
    const ranges: CpuRestoreRange[] = [{ start: 0x0800, bytes: new Uint8Array([0xaa, 0xbb, 0xcc]) }];
    expect(readByteFromRanges(ranges, 0x0801)).toBe(0xbb);
    expect(readByteFromRanges(ranges, 0x0900)).toBeUndefined();
  });
});
