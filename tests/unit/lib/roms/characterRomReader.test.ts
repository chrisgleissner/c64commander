/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

import { addErrorLog } from "@/lib/logging";
import { CharacterRomReadTimeoutError, readCharacterRomViaIrq } from "@/lib/roms/characterRomReader";
import type { CaptureCpuApi } from "@/lib/snapshot/cpu/captureEngine";
import { buildCharacterRomCopyHandler, CHARACTER_ROM_BYTES } from "@/lib/snapshot/cpu/six502/characterRomPayload";

const { layout } = buildCharacterRomCopyHandler();
const VECTOR = 0x0314;

type Interrupt = "on-resume" | "never" | "at-late-pause" | "stuck-mid-copy";

/**
 * The C64 as the reader sees it over REST. The handler is not executed here (its own test runs it);
 * entering it has the handler's effect: disarm, copy, raise `done`, hold until released.
 */
class FakeMachine {
  ram = Uint8Array.from({ length: 0x10000 }, (_, i) => (i * 7 + 3) & 0xff);
  original = this.ram.slice();
  chargen = Uint8Array.from({ length: CHARACTER_ROM_BYTES }, (_, i) => (i * 13 + 5) & 0xff);
  paused = false;
  inHandler = false;
  log: string[] = [];
  /** Writes that landed on the handler while the CPU was still running it. */
  clobberedLiveHandler = 0;
  failOn: ((op: string, address: number, count: number) => boolean) | null = null;
  private reads = new Map<number, number>();

  constructor(private readonly interrupt: Interrupt) {}

  private hooked() {
    return this.ram[VECTOR] === (layout.base & 0xff) && this.ram[VECTOR + 1] === layout.base >> 8;
  }

  private enterHandler() {
    if (!this.hooked() || this.ram[layout.armed] !== 1) return;
    this.ram[layout.armed] = 0;
    this.inHandler = true;
    if (this.interrupt === "stuck-mid-copy") return;
    this.ram.set(this.chargen, layout.buffer);
    this.ram[layout.done] = 1;
  }

  api: CaptureCpuApi = {
    machinePause: async () => {
      this.log.push("pause");
      if (this.interrupt === "at-late-pause" && this.log.filter((e) => e === "pause").length > 1) this.enterHandler();
      this.paused = true;
      return { errors: [] };
    },
    machineResume: async () => {
      this.log.push("resume");
      this.paused = false;
      if (this.inHandler && this.ram[layout.release] === 1 && this.ram[layout.done] === 1) this.inHandler = false;
      if (this.interrupt === "on-resume" || this.interrupt === "stuck-mid-copy") this.enterHandler();
      return { errors: [] };
    },
    readMemory: async (address: string, length = 1) => {
      const start = parseInt(address, 16);
      const count = (this.reads.get(start) ?? 0) + 1;
      this.reads.set(start, count);
      if (this.failOn?.("read", start, count)) throw new Error(`read $${address} failed`);
      return this.ram.slice(start, start + length);
    },
    writeMemoryBlock: async (address: string, data: Uint8Array) => {
      const start = parseInt(address, 16);
      if (this.failOn?.("write", start, 0)) throw new Error(`write $${address} failed`);
      if (start === layout.base && this.inHandler && !this.paused) this.clobberedLiveHandler++;
      this.log.push(`write ${address}`);
      this.ram.set(data, start);
      return { errors: [] };
    },
  };

  region(start: number, length: number) {
    return { now: this.ram.slice(start, start + length), before: this.original.slice(start, start + length) };
  }
}

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), timeoutMs: 2000, pollIntervalMs: 50 };
};

const expectRestored = (machine: FakeMachine, { buffer = true } = {}) => {
  for (const [start, length] of [
    [VECTOR, 2],
    [layout.base, layout.length],
    ...(buffer ? [[layout.buffer, CHARACTER_ROM_BYTES]] : []),
  ]) {
    const { now, before } = machine.region(start, length);
    expect(now, `$${start.toString(16)}`).toEqual(before);
  }
  expect(machine.paused).toBe(false);
  expect(machine.clobberedLiveHandler).toBe(0);
};

beforeEach(() => vi.mocked(addErrorLog).mockClear());

describe("readCharacterRomViaIrq", () => {
  it("returns the copy and leaves every byte it changed as it was, the machine running", async () => {
    const machine = new FakeMachine("on-resume");

    expect(await readCharacterRomViaIrq(machine.api, clock())).toEqual(machine.chargen);

    expectRestored(machine);
    expect(machine.inHandler).toBe(false);
    // The handler is put back only after the release has let the CPU leave it.
    expect(machine.log.slice(-2)).toEqual(["resume", "write 033C"]);
    expect(addErrorLog).not.toHaveBeenCalled();
  });

  it("gives up with a clear error when no interrupt comes, without touching the buffer", async () => {
    const machine = new FakeMachine("never");

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toBeInstanceOf(CharacterRomReadTimeoutError);

    expectRestored(machine);
    expect(machine.log).not.toContain("write C000");
  });

  it("still takes the copy when the interrupt lands between the last poll and the pause", async () => {
    const machine = new FakeMachine("at-late-pause");

    expect(await readCharacterRomViaIrq(machine.api, clock())).toEqual(machine.chargen);

    expectRestored(machine);
  });

  it("lets a copy that never finishes leave by itself rather than overwrite it, and says so", async () => {
    const machine = new FakeMachine("stuck-mid-copy");

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toBeInstanceOf(CharacterRomReadTimeoutError);

    expect(machine.region(VECTOR, 2).now).toEqual(machine.region(VECTOR, 2).before);
    expect(machine.ram[layout.release]).toBe(1);
    expect(machine.clobberedLiveHandler).toBe(0);
    expect(machine.paused).toBe(false);
    expect(addErrorLog).toHaveBeenCalledWith(expect.stringContaining("still running"), expect.anything());
  });

  it("puts everything back and rethrows when the connection fails after the hook is in place", async () => {
    const machine = new FakeMachine("on-resume");
    machine.failOn = (op, address, count) => op === "read" && address === layout.buffer && count === 2;

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toThrow("read $C000 failed");

    expectRestored(machine);
  });

  it("resumes the machine and writes nothing when the bytes to save cannot be read", async () => {
    const machine = new FakeMachine("on-resume");
    machine.failOn = (op, address) => op === "read" && address === layout.base;

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toThrow("read $033C failed");

    expect(machine.log).toEqual(["pause", "resume"]);
  });

  it("logs, and does not hide, a failure to put the machine back", async () => {
    const machine = new FakeMachine("on-resume");
    machine.failOn = (op, address) => op === "write" && address === VECTOR && machine.ram[layout.done] === 1;

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toThrow("write $0314 failed");

    expect(addErrorLog).toHaveBeenCalledWith(expect.stringContaining("Could not put the C64 back"), expect.anything());
  });

  it("puts back the vector and the saved region when the handler could not be written", async () => {
    const machine = new FakeMachine("on-resume");
    let handlerWrites = 0;
    machine.failOn = (op, address) => op === "write" && address === layout.base && ++handlerWrites === 1;

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toThrow("write $033C failed");

    expectRestored(machine);
    expect(machine.log.at(-1)).toBe("resume");
    expect(addErrorLog).not.toHaveBeenCalled();
  });

  it("logs both the original failure and the failed undo, and still throws the original", async () => {
    const machine = new FakeMachine("on-resume");
    let failedAfterHook = false;
    machine.failOn = (op, address, count) => {
      if (op === "read" && address === layout.buffer && count === 2) {
        failedAfterHook = true;
        return true;
      }
      return failedAfterHook && op === "write" && address === VECTOR;
    };

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toThrow("read $C000 failed");

    expect(addErrorLog).toHaveBeenCalledWith("Could not put the C64 back after a failed character ROM read", {
      cause: "read $C000 failed",
      error: "write $0314 failed",
    });
  });

  it("reports failures that are not Error objects by their text", async () => {
    const machine = new FakeMachine("on-resume");
    const readMemory = machine.api.readMemory;
    machine.api.readMemory = async (address, length) => {
      if (parseInt(address, 16) === layout.base) throw "region unreadable";
      return readMemory(address, length);
    };
    machine.api.machineResume = async () => {
      throw "resume refused";
    };

    await expect(readCharacterRomViaIrq(machine.api, clock())).rejects.toBe("region unreadable");

    expect(addErrorLog).toHaveBeenCalledWith("Could not put the C64 back after a failed character ROM read", {
      cause: "region unreadable",
      error: "resume refused",
    });
  });

  describe("with the real clock", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("waits two seconds by default before giving up, and names that time in the error", async () => {
      const machine = new FakeMachine("never");
      const outcome = readCharacterRomViaIrq(machine.api).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(2100);

      const error = await outcome;
      expect(error).toBeInstanceOf(CharacterRomReadTimeoutError);
      expect((error as Error).message).toContain("within 2000 ms");
      expectRestored(machine);
    });

    it("polls every 50 ms by default, so an interrupt that arrives later is still taken", async () => {
      const machine = new FakeMachine("never");
      const outcome = readCharacterRomViaIrq(machine.api);

      await vi.advanceTimersByTimeAsync(500);
      machine.ram[layout.armed] = 0;
      machine.ram.set(machine.chargen, layout.buffer);
      machine.ram[layout.done] = 1;
      await vi.advanceTimersByTimeAsync(50);

      expect(await outcome).toEqual(machine.chargen);
    });
  });
});
