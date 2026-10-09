/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Fast forward, rewind and jumps against a simulated SID player whose rates are the ones measured
 * on a C64 Ultimate. Positions are checked against the music's own position, not the player's
 * clock, because the clock runs ahead of the music while fast forwarding any tune not called once
 * a frame.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRemoteSeekJournal } from "@/lib/playback/remoteSeek/remoteSeekDeviceGuard";
import { machineTimingFor } from "@/lib/playback/remoteSeek/remoteSeekPlan";
import { FAST_FORWARD_MAX_HOLD_MS, RemoteSidSeekController } from "@/lib/playback/remoteSeek/remoteSidSeekController";
import {
  headerPlayCallHz,
  probeRemoteTuneSeek,
  remoteSeekHeaderBlocker,
  type RemoteTuneSeekProfile,
} from "@/lib/playback/remoteSeek/remoteTuneSeekProbe";
import { locateSidPlayerClock } from "@/lib/playback/remoteSeek/sidPlayerClock";
import type { SidHeaderMetadata } from "@/lib/sid/sidUtils";
import { MEASURED_FAST_FORWARD_RATE_BY_MHZ, simulatedClockField } from "../../../mocks/sidPlayerSimulation";
import { C64U_CPU_SPEEDS, createFakeRemoteSeekDevice, DEVICE_KEY } from "./fakeRemoteSeekDevice";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

const header = (overrides: Partial<SidHeaderMetadata> = {}) =>
  ({
    magicId: "PSID",
    playAddress: 0x1003,
    speedBits: 0,
    clock: "pal",
    startSong: 1,
    ...overrides,
  }) as SidHeaderMetadata;

const profile = (overrides: Partial<RemoteTuneSeekProfile> = {}): RemoteTuneSeekProfile => ({
  clock: simulatedClockField(),
  timing: machineTimingFor("PAL"),
  headerPlayCallHz: machineTimingFor("PAL").frameHz,
  cpuSpeedOptions: C64U_CPU_SPEEDS,
  fastForward: { kind: "key" },
  restart: "keys",
  ...overrides,
});

/** Run fake time forward until the promise settles. */
const settle = async <T>(promise: Promise<T>, limitMs = 60_000): Promise<T> => {
  let done = false;
  let value: T | undefined;
  let failure: unknown;
  promise.then(
    (result) => {
      done = true;
      value = result;
    },
    (error) => {
      done = true;
      failure = error;
    },
  );
  for (let elapsed = 0; !done && elapsed < limitMs; elapsed += 10) await vi.advanceTimersByTimeAsync(10);
  if (!done) throw new Error(`did not settle within ${limitMs} ms`);
  if (failure) throw failure;
  return value as T;
};

const cpuSpeedWrites = (log: string[]) =>
  log.filter((entry) => entry.startsWith("CPU Speed=")).map((entry) => entry.replace(/^CPU Speed=/, ""));

describe("remote SID seek controller", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("raises CPU Speed one step a second while Next is held, then gives it back on release", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const positions: number[] = [];
    await settle(
      controller.beginFastForward(
        () => 0,
        (position) => positions.push(position),
      ),
    );
    await vi.advanceTimersByTimeAsync(6500);
    const landed = await settle(controller.endFastForward());
    expect(cpuSpeedWrites(device.log)).toEqual([
      "4 (transient)",
      "8 (transient)",
      "16 (transient)",
      "32 (transient)",
      "64 (transient)",
      "1 (restore)",
    ]);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
    expect(positions.length).toBeGreaterThan(10);
    expect(positions[positions.length - 1]).toBeGreaterThan(300);
  });

  it("ends a fast forward held past the hold limit by itself", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(FAST_FORWARD_MAX_HOLD_MS + 5000);
    expect(controller.isFastForwarding).toBe(false);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("jumps forward to within a second of the target and leaves the device as it was", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const landed = await settle(controller.jumpTo(() => 0, 200));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(199.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(201.5);
    expect(landed?.seconds).toBeGreaterThanOrEqual(200);
    expect(device.player.restarts).toBe(0);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(cpuSpeedWrites(device.log)).toEqual(["64 (transient)", "4 (transient)", "1 (transient)", "1 (restore)"]);
  });

  it("lands a tune with a light play routine, which fast forwards six times faster, without overshooting", async () => {
    const light = Object.fromEntries(
      Object.entries(MEASURED_FAST_FORWARD_RATE_BY_MHZ).map(([mhz, rate]) => [mhz, rate * 6.5]),
    );
    const device = createFakeRemoteSeekDevice({ fastForwardRateByMhz: light, latencyMs: 20 });
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 150));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(149.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(152);
    await settle(controller.jumpTo(() => 150, 60));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(59.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(62);
  });

  it("counts the fast forward that ran until a released key reached the device, for a multi-speed tune", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 200, latencyMs: 25 });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: 200 }));
    await settle(controller.jumpTo(() => 0, 200));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(199.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(202);
  });

  it("lands a multi-speed tune while its first speed change is delayed and config writes are queued", async () => {
    // The play-call counter tune as measured: its rate grows 56-fold from 1 to 64 MHz, more than any HVSC tune did.
    const counterTuneRates = { 1: 15, 2: 17, 4: 57, 8: 110, 16: 220, 32: 440, 64: 840 };
    const device = createFakeRemoteSeekDevice({
      fastForwardRateByMhz: counterTuneRates,
      firstSpeedChangeDelayMs: 1000,
      configWriteDelayMs: 500,
      playCallHz: 200,
      latencyMs: 15,
    });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: 200 }));
    const landed = await settle(controller.jumpTo(() => 0, 45));
    // The tune plays on while the queued config writes give the device back, so check where it landed.
    const sinceLanding = (Date.now() - (landed?.atMs ?? 0)) / 1000;
    expect(device.player.tunePositionSeconds - sinceLanding).toBeGreaterThanOrEqual(44.5);
    expect(device.player.tunePositionSeconds - sinceLanding).toBeLessThan(46.5);
    expect(Math.abs((landed?.seconds ?? 0) + sinceLanding - device.player.tunePositionSeconds)).toBeLessThan(1.5);
  });

  it("lands on slow round trips, which leave more time between clock reads", async () => {
    const device = createFakeRemoteSeekDevice({ latencyMs: 60 });
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 240));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(239.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(242);
  });

  it("releases the key before every CPU Speed change, so a late write cannot overshoot", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 200));
    device.log.forEach((entry, index) => {
      if (entry.startsWith("CPU Speed=") && index > 0) {
        const lastKey = device.log
          .slice(0, index)
          .reverse()
          .find((earlier) => earlier.startsWith("key "));
        expect(lastKey ?? "key release").toMatch(/^key release /);
      }
    });
  });

  it("rewinds by restarting the sub tune and fast forwarding to the target", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 150));
    const landed = await settle(controller.jumpTo(() => 150, 40));
    expect(device.player.restarts).toBe(2);
    expect(device.log).toEqual(expect.arrayContaining(["key press minus", "key release minus", "key press plus"]));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(39.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(41.5);
    expect(landed?.seconds).toBeGreaterThanOrEqual(40);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("lands precisely on a machine the user runs at 8 MHz, finishing at the slowest speed", async () => {
    // A phone's round trips vary, and at 8 MHz that variation is seconds of tune.
    const device = createFakeRemoteSeekDevice({ settings: { "CPU Speed": " 8" }, latencyMs: 20, latencyJitterMs: 60 });
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 150));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(149.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(151.5);
    expect(device.settings["CPU Speed"]).toBe(" 8");
  });

  it("pulses towards a near target at the slowest speed when the user runs the machine at 8 MHz", async () => {
    const light = Object.fromEntries(
      Object.entries(MEASURED_FAST_FORWARD_RATE_BY_MHZ).map(([mhz, rate]) => [mhz, rate * 6.5]),
    );
    const device = createFakeRemoteSeekDevice({
      settings: { "CPU Speed": " 8" },
      fastForwardRateByMhz: light,
      latencyMs: 20,
      latencyJitterMs: 40,
      keyReleaseDelayMs: 40,
    });
    const controller = new RemoteSidSeekController(device.api, profile());
    await vi.advanceTimersByTimeAsync(60_000);
    const landed = await settle(controller.jumpTo(() => device.player.tunePositionSeconds, 30));
    const sinceLanding = (Date.now() - (landed?.atMs ?? 0)) / 1000;
    expect(device.player.tunePositionSeconds - sinceLanding).toBeGreaterThan(29.5);
    expect(device.player.tunePositionSeconds - sinceLanding).toBeLessThan(31.5);
    expect(cpuSpeedWrites(device.log)).toEqual(["1 (transient)", "8 (restore)"]);
  });

  it("lands an NTSC tune on a PAL machine on the music's position, not the faster clock", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 60 });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: 60 }));
    await settle(controller.jumpTo(() => 0, 120));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(119.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(121.5);
  });

  it("measures a CIA-timed tune's play-call rate from the timer before it jumps", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 200 });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null }));
    await settle(controller.jumpTo(() => 0, 60));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(59.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(61.5);
  });

  it("samples a CIA-timed tune's timer often enough that forty reads short of the top do not matter", async () => {
    // Forty reads that kept meeting the timer below 85% of its latch, as on the Ultimate 64.
    const short = Array.from({ length: 40 }, (_, index) => 0.05 + (0.79 * ((index * 13) % 40)) / 40);
    const device = createFakeRemoteSeekDevice({ playCallHz: 100, timerFractions: short });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null }));
    await settle(controller.jumpTo(() => 0, 300));
    expect(device.player.tunePositionSeconds).toBeGreaterThan(298);
    expect(device.player.tunePositionSeconds).toBeLessThan(302);
  });

  it("measures a CIA-timed tune's rate once when a jump arrives while it is being measured", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 200 });
    const read = device.api.readMemory;
    let timerReads = 0;
    device.api.readMemory = async (address, length, options) => {
      if (address === "DC04") timerReads += 1;
      return read(address, length, options);
    };
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null }));
    const prepared = controller.prepare();
    await vi.advanceTimersByTimeAsync(100);
    await settle(controller.jumpTo(() => 0, 100));
    await settle(prepared);
    expect(timerReads).toBe(100);
    expect(device.player.tunePositionSeconds).toBeGreaterThan(98);
    expect(device.player.tunePositionSeconds).toBeLessThan(102);
  });

  it("measures a CIA-timed tune's rate when the timer reads would repeat at the timer's own period", async () => {
    // Four calls a PAL frame is a 5 ms timer period, and each read takes 5 ms: evenly spaced reads all
    // see about the same count, whose largest value is then far below the latch.
    const device = createFakeRemoteSeekDevice({ playCallHz: 985248 / 4914, timerFollowsClock: true, latencyMs: 5 });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null }));
    // Start the reads in the middle of a timer period rather than at its top.
    await vi.advanceTimersByTimeAsync(2);
    await settle(controller.jumpTo(() => 0, 120));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(119.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(122);
  });

  it("reads where a fast forward stopped once the released key took effect, through the clock wrapping at 99:59", async () => {
    // A light tune at 64 MHz passes a clock second every millisecond or so, and the player only
    // notices a released key at its next keyboard scan.
    const light = Object.fromEntries(
      Object.entries(MEASURED_FAST_FORWARD_RATE_BY_MHZ).map(([mhz, rate]) => [mhz, rate * 10]),
    );
    const device = createFakeRemoteSeekDevice({ fastForwardRateByMhz: light, keyReleaseDelayMs: 40 });
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(6500);
    const landed = await settle(controller.endFastForward());
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(2);
  });

  it("does not take a clock read caught mid-update for the clock wrapping at 99:59 during a jump", async () => {
    const device = createFakeRemoteSeekDevice({ tornClockReads: [30, 60, 90, 120] });
    const controller = new RemoteSidSeekController(device.api, profile());
    const landed = await settle(controller.jumpTo(() => 0, 400));
    expect(device.player.tunePositionSeconds).toBeGreaterThan(398);
    expect(device.player.tunePositionSeconds).toBeLessThan(402);
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
  });

  it("does not take a clock read caught mid-update for the clock wrapping at 99:59 while Next is held", async () => {
    const device = createFakeRemoteSeekDevice({ tornClockReads: [5, 8, 11] });
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(4000);
    const landed = await settle(controller.endFastForward());
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
  });

  it("gives the device back when a jump is cancelled half way", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const jump = controller.jumpTo(() => 0, 1000);
    await vi.advanceTimersByTimeAsync(300);
    await settle(controller.cancel("stop"));
    // It reports where it got to, so the display does not go back to where the jump started.
    const landed = await settle(jump);
    expect(Math.abs((landed?.seconds ?? -10) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
  });

  it("gives the device back when the fast forward is cancelled while Next is held", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(3000);
    await settle(controller.cancel("pause"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(controller.isFastForwarding).toBe(false);
  });

  it("starts no timers for a fast forward cancelled while its key press was on the wire", async () => {
    const device = createFakeRemoteSeekDevice({ latencyMs: 40 });
    let pressSent = false;
    const send = device.api.sendMachineInputBatch;
    device.api.sendMachineInputBatch = (batch) => {
      if (batch.events.some((event) => event.kind === "keyboard" && event.transition === "press")) pressSent = true;
      return send(batch);
    };
    const reads: string[] = [];
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) => {
      reads.push(address);
      return read(address, length, options);
    };
    const controller = new RemoteSidSeekController(device.api, profile());
    const begin = controller.beginFastForward(
      () => 0,
      () => undefined,
    );
    for (let waited = 0; !pressSent && waited < 2000; waited += 1) await vi.advanceTimersByTimeAsync(1);
    await settle(controller.cancel("pause"));
    await settle(begin.catch(() => undefined));
    reads.length = 0;
    await vi.advanceTimersByTimeAsync(3000);
    expect(reads).toEqual([]);
    expect(device.player.heldKeys).toEqual([]);
    expect(controller.isBusy).toBe(false);
  });

  it("sends no restart keys for a rewind cancelled before it began", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 120));
    device.log.length = 0;
    const first = controller.jumpTo(() => 120, 150);
    const rewind = controller.jumpTo(() => 150, 30);
    await settle(controller.cancel("pause"));
    await settle(Promise.all([first, rewind]));
    expect(device.log.filter((entry) => entry.includes("minus") || entry.includes("plus"))).toEqual([]);
    expect(device.player.restarts).toBe(0);
  });

  it("sends nothing more to a device the app switched away from in the middle of a restart", async () => {
    const device = createFakeRemoteSeekDevice({ latencyMs: 10 });
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 100));
    let pressedMinus = false;
    const send = device.api.sendMachineInputBatch;
    device.api.sendMachineInputBatch = (batch) => {
      if (batch.events.some((event) => event.kind === "keyboard" && event.inputs.includes("minus")))
        pressedMinus = true;
      return send(batch);
    };
    const rewind = controller.jumpTo(() => 100, 20);
    for (let waited = 0; !pressedMinus && waited < 5000; waited += 1) await vi.advanceTimersByTimeAsync(1);
    device.connectTo(JSON.stringify(["f13e69", "u2"]));
    const logged = device.log.length;
    await settle(rewind);
    // Only the press already on its way can arrive; neither its release nor plus follows on the new device.
    expect(device.log.slice(logged).filter((entry) => entry !== "key press minus")).toEqual([]);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({ keyHeld: true });
  });

  it("counts the clock once per second when reads overlap and return out of order", async () => {
    const device = createFakeRemoteSeekDevice();
    // Every other read is slow, so a read started later can return before one started earlier.
    let reads = 0;
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) => {
      const value = await read(address, length, options);
      await new Promise((resolve) => setTimeout(resolve, reads++ % 2 === 0 ? 600 : 50));
      return value;
    };
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(3000);
    const landed = await settle(controller.endFastForward());
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(2.5);
  });

  it("starts an operation queued behind a jump from where that jump left the tune", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    let position = 0;
    const jump = controller
      .jumpTo(() => position, 120)
      .then((landing) => {
        position = landing?.seconds ?? position;
        return landing;
      });
    const second = controller.jumpTo(() => position, 60);
    await settle(Promise.all([jump, second]));
    expect(device.player.restarts).toBe(2);
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(59.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(62);
  });

  it("rewinds on a machine without CPU Speed at the machine's own speed", async () => {
    const device = createFakeRemoteSeekDevice({ cartridge: false });
    const controller = new RemoteSidSeekController(device.api, profile({ cpuSpeedOptions: [] }));
    await vi.advanceTimersByTimeAsync(100_000);
    expect(controller.canRewind).toBe(true);
    await settle(controller.jumpTo(() => 100, 10));
    expect(device.player.restarts).toBe(2);
    expect(cpuSpeedWrites(device.log)).toEqual([]);
    expect(device.player.tunePositionSeconds).toBeGreaterThan(9.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(12);
  });

  it.each([
    { name: "back to just after the start", from: 30, target: 2.5 },
    { name: "a few seconds forward", from: 30, target: 33 },
    { name: "back half way, before any rate is known", from: 54, target: 27 },
    { name: "twenty seconds forward, before any rate is known", from: 30, target: 50 },
  ])("lands a light tune $name by playing into the target rather than overshooting it", async ({ from, target }) => {
    // The counter tune with an empty play routine: 65 times real time at 1 MHz on the C64 Ultimate.
    const light = Object.fromEntries(
      Object.entries(MEASURED_FAST_FORWARD_RATE_BY_MHZ).map(([mhz, rate]) => [mhz, rate * 6.5]),
    );
    const device = createFakeRemoteSeekDevice({
      fastForwardRateByMhz: light,
      latencyMs: 20,
      latencyJitterMs: 40,
      keyReleaseDelayMs: 40,
    });
    const controller = new RemoteSidSeekController(device.api, profile());
    await vi.advanceTimersByTimeAsync(from * 1000);
    const landed = await settle(controller.jumpTo(() => device.player.tunePositionSeconds, target));
    expect(device.player.tunePositionSeconds).toBeGreaterThan(target - 0.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(target + 1.5);
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(1);
  });

  it("turns Vol Master off before a rewind restarts the tune, and on again as soon as the key is up", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(controller.jumpTo(() => 60, 20));
    const at = (entry: string) => device.log.indexOf(entry);
    expect(at("Vol Master=OFF (transient)")).toBeGreaterThanOrEqual(0);
    expect(at("Vol Master=OFF (transient)")).toBeLessThan(at("key press minus"));
    expect(at("Vol Master=0 dB (restore)")).toBeGreaterThan(device.log.lastIndexOf("key release arrow_left"));
    expect(device.log.filter((entry) => entry.startsWith("Vol Master"))).toHaveLength(2);
    expect(device.settings["Vol Master"]).toBe(" 0 dB");
  });

  it("mutes a held fast forward from its first key press until it is given back, before CPU Speed", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile(), null, () => "always");
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(2500);
    await settle(controller.endFastForward());
    const at = (entry: string) => device.log.indexOf(entry);
    expect(at("Vol Master=OFF (transient)")).toBeLessThan(at("key press arrow_left"));
    expect(at("Vol Master=0 dB (restore)")).toBeGreaterThan(device.log.lastIndexOf("key release arrow_left"));
    expect(at("Vol Master=0 dB (restore)")).toBeLessThan(at("CPU Speed=1 (restore)"));
    expect(device.settings["Vol Master"]).toBe(" 0 dB");
  });

  it.each([
    { setting: "always" as const, hold: true, forward: true, rewind: true },
    { setting: "rewind" as const, hold: false, forward: false, rewind: true },
    { setting: "never" as const, hold: false, forward: false, rewind: false },
  ])("mutes as Settings say for $setting", async ({ setting, hold, forward, rewind }) => {
    const muted = async (seek: (controller: RemoteSidSeekController) => Promise<unknown>) => {
      localStorage.clear();
      const device = createFakeRemoteSeekDevice();
      const controller = new RemoteSidSeekController(device.api, profile(), null, () => setting);
      await vi.advanceTimersByTimeAsync(60_000);
      await settle(seek(controller));
      return device.log.includes("Vol Master=OFF (transient)");
    };
    expect(
      await muted(async (controller) => {
        await controller.beginFastForward(
          () => 60,
          () => undefined,
        );
        await vi.advanceTimersByTimeAsync(1500);
        await controller.endFastForward();
      }),
    ).toBe(hold);
    expect(await muted((controller) => controller.jumpTo(() => 60, 200))).toBe(forward);
    expect(await muted((controller) => controller.jumpTo(() => 60, 20))).toBe(rewind);
  });

  it("leaves the sound on for a short jump that only plays into its target", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await vi.advanceTimersByTimeAsync(30_000);
    await settle(controller.jumpTo(() => device.player.tunePositionSeconds, 32));
    expect(device.log.filter((entry) => entry.startsWith("Vol Master"))).toEqual([]);
  });

  it("rewinds without muting a machine that has no Vol Master, or whose Vol Master is already off", async () => {
    for (const settings of [{ "Vol Master": "OFF" }, {}]) {
      const device = createFakeRemoteSeekDevice({ settings });
      if (!("Vol Master" in settings)) {
        const read = device.api.getConfigItem;
        device.api.getConfigItem = async (category, item, options) => {
          if (item === "Vol Master") throw new Error("HTTP 404");
          return read(category, item, options);
        };
      }
      const controller = new RemoteSidSeekController(device.api, profile());
      await vi.advanceTimersByTimeAsync(60_000);
      await settle(controller.jumpTo(() => 60, 20));
      expect(device.log.filter((entry) => entry.startsWith("Vol Master"))).toEqual([]);
      expect(device.player.restarts).toBe(2);
    }
  });

  it("treats the clock as the position only for a tune called once a frame on its own machine", () => {
    const device = createFakeRemoteSeekDevice();
    expect(new RemoteSidSeekController(device.api, profile()).clockIsPosition).toBe(true);
    expect(new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: 60 })).clockIsPosition).toBe(false);
    expect(new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null })).clockIsPosition).toBe(false);
  });

  it("finds when the player's clock ticks, to within a few hundredths of a second", async () => {
    vi.setSystemTime(2_000_000);
    const device = createFakeRemoteSeekDevice({ latencyMs: 12 });
    await vi.advanceTimersByTimeAsync(3_370);
    const controller = new RemoteSidSeekController(device.api, profile());
    const tick = await settle(controller.clockTick());
    // The simulated clock turned a second every 1000 ms since 2_000_000.
    expect(tick?.clockSeconds).toBe(4);
    expect(Math.abs((tick?.tickAtMs ?? 0) - 2_004_000)).toBeLessThanOrEqual(25);
  });

  it("does not follow the clock of a multi-speed tune, which runs ahead of its music", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 200 });
    const read = vi.spyOn(device.api, "readMemory");
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null }));
    expect(await controller.clockTick()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not jump back when the tune can be restarted neither by key nor by playing it again", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile({ restart: "replay" }));
    expect(controller.canRewind).toBe(false);
    expect(await settle(controller.jumpTo(() => 100, 10))).toBeNull();
    expect(device.log).toEqual([]);
  });

  it("reads where a hold stopped only after the restore released a key whose release timed out", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(2500);
    device.failures.keyEvents = 1;
    device.failures.keyEventStallMs = 8000;
    const landed = await settle(controller.endFastForward());
    expect(device.player.heldKeys).toEqual([]);
    expect(Math.abs((landed?.seconds ?? -1000) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
  });

  it("counts the wait for a key press that timed out as normal play, for a multi-speed tune", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 200 });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: 200 }));
    device.failures.keyEvents = 1;
    device.failures.keyEventStallMs = 8000;
    const landed = await settle(controller.jumpTo(() => 0, 300));
    expect(landed?.completed).toBe(false);
    expect(device.player.tunePositionSeconds).toBeGreaterThan(7);
    expect(Math.abs((landed?.seconds ?? -1000) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
  });

  it("restores the device when a jump fails part way, and reports where the tune got to", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    device.failures.keyEvents = 1;
    const landed = await settle(controller.jumpTo(() => 0, 200));
    expect(Math.abs((landed?.seconds ?? -10) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });
});

/** Every System Mode the Ultimate offers, with a PAL and an NTSC tune on each. */
describe.each(["PAL", "NTSC", "PAL-60", "NTSC-50", "PAL-60/L", "NTSC-50/L"])(
  "remote seek on a machine in %s",
  (mode) => {
    beforeEach(() => {
      localStorage.clear();
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each(["pal", "ntsc"] as const)("finds the clock and lands every seek of a %s tune", async (tuneClock) => {
      const timing = machineTimingFor(mode);
      const sixtyHz = timing.frameCycles === 17095;
      // How the player calls a once-a-frame tune: at the frame rate on its own standard, otherwise at
      // 16388 cycles (an NTSC tune on PAL, measured) or the 20514-cycle latch (a PAL tune on NTSC).
      const playCallHz =
        tuneClock === "pal"
          ? sixtyHz
            ? timing.ciaClockHz / 20514
            : timing.frameHz
          : sixtyHz
            ? timing.frameHz
            : timing.ciaClockHz / 16388;
      const device = createFakeRemoteSeekDevice({
        settings: { "System Mode": mode },
        playCallHz,
        machineFrameHz: timing.frameHz,
        ciaClockHz: timing.ciaClockHz,
      });
      const found = await settle(probeRemoteTuneSeek(device.api, header({ clock: tuneClock }), 1));
      expect(found?.timing).toEqual(timing);
      expect(found?.headerPlayCallHz).toBeCloseTo(playCallHz, 9);
      const controller = new RemoteSidSeekController(device.api, found!);
      expect(controller.clockIsPosition).toBe(Math.abs(playCallHz - timing.frameHz) < 1e-9);
      const at = () => device.player.tunePositionSeconds;
      await settle(controller.jumpTo(at, 150));
      expect(Math.abs(at() - 150)).toBeLessThan(2);
      await settle(controller.beginFastForward(at, () => undefined));
      await vi.advanceTimersByTimeAsync(1500);
      const held = await settle(controller.endFastForward());
      expect(Math.abs((held?.seconds ?? 0) - at())).toBeLessThan(1.5);
      await settle(controller.jumpTo(at, 30));
      expect(Math.abs(at() - 30)).toBeLessThan(2);
      expect(device.player.heldKeys).toEqual([]);
    });

    it("lands a CIA-timed tune by the rate its latch gives at this mode's clock, not a multiple of 50 or 60", async () => {
      const timing = machineTimingFor(mode);
      // The latch a PAL composer writes for twice a frame; on a 65-cycle machine it plays 104 times a second.
      const latch = 19656 / 2 - 1;
      const device = createFakeRemoteSeekDevice({
        settings: { "System Mode": mode },
        playCallHz: timing.ciaClockHz / (latch + 1),
        machineFrameHz: timing.ciaClockHz / timing.frameCycles,
        ciaClockHz: timing.ciaClockHz,
      });
      const found = await settle(probeRemoteTuneSeek(device.api, header({ speedBits: 1 }), 1));
      const controller = new RemoteSidSeekController(device.api, found!);
      await settle(controller.prepare());
      const at = () => device.player.tunePositionSeconds;
      await settle(controller.beginFastForward(at, () => undefined));
      await vi.advanceTimersByTimeAsync(4500);
      const held = await settle(controller.endFastForward());
      expect(at()).toBeGreaterThan(100);
      expect(Math.abs((held?.seconds ?? 0) - at()) / at()).toBeLessThan(0.005);
    });
  },
);

describe("remote seek support", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("refuses RSID tunes and PSIDs without a play routine, which the player cannot speed up", () => {
    expect(remoteSeekHeaderBlocker(header())).toBeNull();
    expect(remoteSeekHeaderBlocker(header({ magicId: "RSID" }))).toMatch(/RSID/);
    expect(remoteSeekHeaderBlocker(header({ playAddress: 0 }))).toMatch(/own interrupt/);
    expect(remoteSeekHeaderBlocker(null)).toMatch(/not available/);
  });

  it("takes the play-call rate from the header unless the sub tune is CIA-timed", () => {
    const pal = machineTimingFor("PAL");
    expect(headerPlayCallHz(header({ clock: "ntsc" }), 1, pal)).toBeCloseTo(985248 / 16388, 9);
    expect(headerPlayCallHz(header({ clock: "pal_ntsc" }), 1, pal)).toBe(pal.frameHz);
    expect(headerPlayCallHz(header({ speedBits: 0b10 }), 2, pal)).toBeNull();
    expect(headerPlayCallHz(header({ speedBits: 0b10 }), 1, pal)).toBe(pal.frameHz);
    expect(headerPlayCallHz(header({ clock: "pal" }), 1, machineTimingFor("NTSC"))).toBeCloseTo(1022727 / 20514, 9);
    expect(headerPlayCallHz(header({ speedBits: 0x8000_0000 }), 40, pal)).toBeNull();
  });

  it("finds the player's clock, not the song length beside it, and reads the machine's settings", async () => {
    vi.useFakeTimers();
    const device = createFakeRemoteSeekDevice();
    const found = await settle(probeRemoteTuneSeek(device.api, header(), 1));
    vi.useRealTimers();
    expect(found).toEqual({
      clock: simulatedClockField(),
      timing: machineTimingFor("PAL"),
      headerPlayCallHz: machineTimingFor("PAL").frameHz,
      cpuSpeedOptions: C64U_CPU_SPEEDS,
      fastForward: { kind: "key" },
      restart: "keys",
    });
  });

  it.each([
    {
      name: "elsewhere on the screen, unpadded",
      layout: { clockRow: 5, clockColumn: 30, clockFormat: "m:ss" as const },
    },
    {
      name: "with hours and no title or song length",
      layout: { clockRow: 0, clockColumn: 20, clockFormat: "h:mm:ss" as const, title: "", songLengthRow: null },
    },
  ])("finds and follows the clock of a redesigned player that draws it $name", async ({ layout }) => {
    vi.useFakeTimers();
    const device = createFakeRemoteSeekDevice({ layout });
    const found = await settle(probeRemoteTuneSeek(device.api, header(), 1));
    expect(found?.clock).toEqual(simulatedClockField(layout));
    const controller = new RemoteSidSeekController(device.api, found!);
    // Across 9:59 to 10:00, where an unpadded clock grows by a cell.
    const landed = await settle(controller.jumpTo(() => device.player.tunePositionSeconds, 700));
    expect(device.player.tunePositionSeconds).toBeGreaterThan(698.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(701.5);
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
    vi.useRealTimers();
  });

  it("does not read a screen that lies under the I/O area, where reads would reach the CIAs", async () => {
    const reads: string[] = [];
    const found = await locateSidPlayerClock(async (address, length) => {
      reads.push(address);
      if (address === "DD00") return Uint8Array.of(0x94);
      if (address === "D018") return Uint8Array.of(0x45);
      return new Uint8Array(length);
    });
    expect(found).toBeNull();
    expect(reads).toEqual(["DD00", "D018"]);
  });

  it("reports no support when the SID player is not on screen", async () => {
    vi.useFakeTimers();
    const device = createFakeRemoteSeekDevice();
    device.api.readMemory = async (_address, length) => new Uint8Array(length);
    expect(await settle(probeRemoteTuneSeek(device.api, header(), 1))).toBeNull();
    vi.useRealTimers();
  });
});

describe("remote SID seek controller when the device misbehaves", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const blankClock = (device: ReturnType<typeof createFakeRemoteSeekDevice>, after = 0) => {
    const read = device.api.readMemory;
    let reads = 0;
    const clock = 0x0b98;
    device.api.readMemory = async (address, length, options) => {
      const data = await read(address, length, options);
      const start = parseInt(address, 16);
      if (clock >= start && clock < start + length && reads++ >= after) data.fill(0, clock - start, clock - start + 5);
      return data;
    };
  };

  it("probes on with PAL timing and fast forward only when System Mode and CPU Speed cannot be read", async () => {
    const device = createFakeRemoteSeekDevice();
    device.api.getConfigItem = async () => {
      throw new Error("HTTP 503");
    };
    const found = await settle(probeRemoteTuneSeek(device.api, header(), 1));
    expect(found).toMatchObject({ timing: machineTimingFor("PAL"), cpuSpeedOptions: [] });
  });

  it("reports no support while the player's clock does not tick", async () => {
    const device = createFakeRemoteSeekDevice();
    blankClock(device);
    expect(await settle(probeRemoteTuneSeek(device.api, header(), 1))).toBeNull();
  });

  it("fast forwards without a ramp on a machine without CPU Speed", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile({ cpuSpeedOptions: [] }));
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(3000);
    await settle(controller.endFastForward());
    expect(device.log.filter((entry) => entry.startsWith("CPU Speed"))).toEqual([]);
    expect(device.log.filter((entry) => entry === "key press arrow_left")).toHaveLength(1);
    expect(await settle(controller.endFastForward())).toBeNull();
  });

  it("gives the device back when the clock is not on screen as a fast forward starts", async () => {
    const device = createFakeRemoteSeekDevice();
    blankClock(device);
    const controller = new RemoteSidSeekController(device.api, profile());
    await expect(
      settle(
        controller.beginFastForward(
          () => 0,
          () => undefined,
        ),
      ),
    ).rejects.toThrow(/clock/);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    expect(controller.isBusy).toBe(false);
  });

  it("keeps fast forwarding when a ramp step or a clock read fails, and lands from the last good read", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    device.failures.configWrites = 1;
    const read = device.api.readMemory;
    let failing = true;
    device.api.readMemory = async (address, length, options) => {
      if (failing && address === "0B98") throw new Error("HTTP 503");
      return read(address, length, options);
    };
    await vi.advanceTimersByTimeAsync(1600);
    failing = false;
    await vi.advanceTimersByTimeAsync(1000);
    device.api.readMemory = async (address, length) => {
      if (address === "0B98") throw new Error("HTTP 503");
      return read(address, length);
    };
    const landed = await settle(controller.endFastForward());
    expect(landed?.completed).toBe(true);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("reports a jump that could not read the clock at all as not having moved", async () => {
    const device = createFakeRemoteSeekDevice();
    blankClock(device);
    const controller = new RemoteSidSeekController(device.api, profile());
    expect(await settle(controller.jumpTo(() => 0, 60))).toBeNull();
  });

  it("rides out a few unreadable clock frames during a jump", async () => {
    const device = createFakeRemoteSeekDevice();
    const read = device.api.readMemory;
    let reads = 0;
    device.api.readMemory = async (address, length, options) =>
      address === "0B98" && reads++ % 5 === 3 ? new Uint8Array(length) : read(address, length, options);
    const controller = new RemoteSidSeekController(device.api, profile());
    const landed = await settle(controller.jumpTo(() => 0, 90));
    expect(landed?.completed).toBe(true);
    expect(device.player.tunePositionSeconds).toBeGreaterThan(89);
  });

  it("keeps jumping deep into an hour-long tune on a machine without CPU Speed while it moves", async () => {
    const device = createFakeRemoteSeekDevice({ fastForwardRateByMhz: { 1: 20 } });
    const controller = new RemoteSidSeekController(device.api, profile({ cpuSpeedOptions: [] }));
    const landed = await settle(
      controller.jumpTo(() => 0, 3600),
      400_000,
    );
    expect(landed?.completed).toBe(true);
    expect(device.player.tunePositionSeconds).toBeGreaterThan(3598);
    expect(device.player.tunePositionSeconds).toBeLessThan(3603);
  });

  it("keeps jumping an 8x multi-speed tune on a machine without CPU Speed, whose music moves slowly but whose clock does not", async () => {
    // 10 clock seconds a second at 1 MHz: an 8x tune's music moves only 1.25 seconds a second.
    const device = createFakeRemoteSeekDevice({ playCallHz: 400, fastForwardRateByMhz: { 1: 10 } });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: 400, cpuSpeedOptions: [] }));
    const landed = await settle(
      controller.jumpTo(() => 0, 60),
      200_000,
    );
    expect(landed?.completed).toBe(true);
    expect(device.player.tunePositionSeconds).toBeGreaterThan(58);
  });

  it("stops a jump when the key does not fast forward the tune, and reports where it got to", async () => {
    const device = createFakeRemoteSeekDevice({ fastForwardRateByMhz: { 1: 1, 4: 1, 64: 1 } });
    const controller = new RemoteSidSeekController(device.api, profile());
    const landed = await settle(
      controller.jumpTo(() => 0, 600),
      120_000,
    );
    expect(landed?.completed).toBe(false);
    expect(Math.abs((landed?.seconds ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("stops a jump once the clock has been unreadable for a while", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const read = device.api.readMemory;
    let clockReads = 0;
    device.api.readMemory = async (address, length, options) =>
      address === "0B98" && ++clockReads > 1 ? new Uint8Array(length) : read(address, length, options);
    const landed = await settle(
      controller.jumpTo(() => 5, 600),
      120_000,
    );
    expect(landed?.completed).toBe(false);
    expect(device.player.heldKeys).toEqual([]);
  });

  it("gives up on a restart that never brings the clock back to zero", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 100));
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) => {
      const value = await read(address, length, options);
      return address === "0B98" ? new TextEncoder().encode("01:40") : value;
    };
    const landed = await settle(controller.jumpTo(() => 100, 20));
    expect(landed?.completed).toBe(false);
    expect(device.player.heldKeys).toEqual([]);
  });

  /** The C64 back at BASIC: the VIC shows $0400 and no clock is drawn where the player's was. */
  const basicOnScreen = (device: ReturnType<typeof createFakeRemoteSeekDevice>) => {
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) => {
      if (address === "DD00") return Uint8Array.of(0x97);
      if (address === "D018") return Uint8Array.of(0x15);
      if (address === "0B98") return new TextEncoder().encode("READY.");
      return read(address, length, options);
    };
  };
  const keyPresses = (device: ReturnType<typeof createFakeRemoteSeekDevice>) =>
    device.log.filter((entry) => entry.startsWith("key press"));

  it("presses no fast forward key once the C64 has left the SID player", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    basicOnScreen(device);
    await expect(
      settle(
        controller.beginFastForward(
          () => 0,
          () => undefined,
        ),
      ),
    ).rejects.toThrow();
    // No clock, so no position to report: the jump gives up before it has one.
    expect((await settle(controller.jumpTo(() => 0, 100)))?.completed ?? false).toBe(false);
    expect(keyPresses(device)).toEqual([]);
  });

  it("refuses a key when the VIC shows another screen, even if a time appears where the clock was", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) =>
      address === "D018" ? Uint8Array.of(0x15) : read(address, length, options);
    expect(await settle(controller.jumpTo(() => 0, 100))).toMatchObject({ completed: false });
    expect(keyPresses(device)).toEqual([]);
  });

  it("lets go of a held fast forward within two reads of the SID player leaving the screen", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(
      controller.beginFastForward(
        () => 0,
        () => undefined,
      ),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(device.player.heldKeys).toEqual(["arrow_left"]);
    basicOnScreen(device);
    await vi.advanceTimersByTimeAsync(700);
    expect(device.player.heldKeys).toEqual([]);
    expect(controller.isFastForwarding).toBe(false);
  });

  it("lets go of a jump's key at the first read that finds no clock", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const jump = controller.jumpTo(() => 0, 1200);
    for (let waited = 0; !device.player.heldKeys.length && waited < 5000; waited += 10)
      await vi.advanceTimersByTimeAsync(10);
    expect(device.player.heldKeys).toEqual(["arrow_left"]);
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) =>
      address === "0B98" ? new Uint8Array(length) : read(address, length, options);
    await vi.advanceTimersByTimeAsync(150);
    expect(device.player.heldKeys).toEqual([]);
    await settle(jump);
  });

  it("sends no restart keys once the SID player has left the screen, where BASIC would type them", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 100));
    device.log.length = 0;
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) =>
      address === "0B98" ? new TextEncoder().encode("READY.") : read(address, length, options);
    const landed = await settle(controller.jumpTo(() => 100, 20));
    expect(landed?.completed).toBe(false);
    expect(device.log.filter((entry) => entry.startsWith("key press"))).toEqual([]);
  });

  it("does not take one read of a clock caught mid-update for a restart", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(() => 0, 100));
    // The restart keys never reach the player, and the first clock read shows 01:00 as 00:00.
    const send = device.api.sendMachineInputBatch;
    device.api.sendMachineInputBatch = async (batch) =>
      batch.events.some((event) => event.kind === "keyboard" && /minus|plus/.test(event.inputs.join()))
        ? {}
        : send(batch);
    const read = device.api.readMemory;
    let clockReads = 0;
    device.api.readMemory = async (address, length, options) => {
      const value = await read(address, length, options);
      return address === "0B98" && ++clockReads === 1 ? new TextEncoder().encode("00:00") : value;
    };
    const landed = await settle(controller.jumpTo(() => 100, 20));
    expect(landed?.completed).toBe(false);
    expect(device.player.tunePositionSeconds).toBeGreaterThan(100);
    expect(device.player.heldKeys).toEqual([]);
  });

  it("does not take a clock that already showed 0:01 for a restart", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await vi.advanceTimersByTimeAsync(1300);
    const send = device.api.sendMachineInputBatch;
    device.api.sendMachineInputBatch = async (batch) =>
      batch.events.some((event) => event.kind === "keyboard" && /minus|plus/.test(event.inputs.join()))
        ? {}
        : send(batch);
    const landed = await settle(controller.jumpTo(() => 1.3, 0.1));
    expect(landed?.completed).toBe(false);
    expect(device.player.heldKeys).toEqual([]);
  });

  it("falls back to the frame rate when a CIA-timed tune's timer cannot be sampled", async () => {
    const device = createFakeRemoteSeekDevice();
    const read = device.api.readMemory;
    device.api.readMemory = async (address, length, options) =>
      address === "DC04" ? new Uint8Array(length) : read(address, length, options);
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null }));
    await settle(controller.jumpTo(() => 0, 40));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(39.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(42);
  });
});
