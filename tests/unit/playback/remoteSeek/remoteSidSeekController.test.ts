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
import {
  FAST_FORWARD_MAX_HOLD_MS,
  headerPlayCallHz,
  probeRemoteTuneSeek,
  remoteSeekHeaderBlocker,
  RemoteSidSeekController,
  type RemoteTuneSeekProfile,
} from "@/lib/playback/remoteSeek/remoteSidSeekController";
import type { SidHeaderMetadata } from "@/lib/sid/sidUtils";
import { MEASURED_FAST_FORWARD_RATE_BY_MHZ, SIMULATED_SCREEN_ADDRESS } from "../../../mocks/sidPlayerSimulation";
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
  screenAddress: SIMULATED_SCREEN_ADDRESS,
  timing: machineTimingFor("PAL"),
  headerPlayCallHz: 50,
  cpuSpeedOptions: C64U_CPU_SPEEDS,
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
      "2 (transient)",
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
    await settle(controller.jumpTo(() => 0, 45));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(44.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(46.5);
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

  it("measures a CIA-timed tune's rate when the timer reads would repeat at the timer's own period", async () => {
    // 200 calls a second is a 5 ms timer period, and each read takes 5 ms: evenly spaced reads all
    // see about the same count, whose largest value is then far below the latch.
    const device = createFakeRemoteSeekDevice({ playCallHz: 200, timerFollowsClock: true, latencyMs: 5 });
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

  it("does not jump back on a machine without CPU Speed", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile({ cpuSpeedOptions: [] }));
    expect(controller.canRewind).toBe(false);
    expect(await settle(controller.jumpTo(() => 100, 10))).toBeNull();
    expect(device.log).toEqual([]);
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
    expect(headerPlayCallHz(header({ clock: "ntsc" }), 1, pal)).toBe(60);
    expect(headerPlayCallHz(header({ clock: "pal_ntsc" }), 1, pal)).toBe(50);
    expect(headerPlayCallHz(header({ speedBits: 0b10 }), 2, pal)).toBeNull();
    expect(headerPlayCallHz(header({ speedBits: 0b10 }), 1, pal)).toBe(50);
    expect(headerPlayCallHz(header({ speedBits: 0x8000_0000 }), 40, pal)).toBeNull();
  });

  it("finds the player's screen and reads the machine's settings", async () => {
    const device = createFakeRemoteSeekDevice();
    const found = await probeRemoteTuneSeek(device.api, header(), 1);
    expect(found).toEqual({
      screenAddress: SIMULATED_SCREEN_ADDRESS,
      timing: machineTimingFor("PAL"),
      headerPlayCallHz: 50,
      cpuSpeedOptions: C64U_CPU_SPEEDS,
    });
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
    device.api.readMemory = async (address, length, options) =>
      address === "0B98" && reads++ >= after ? new Uint8Array(length) : read(address, length, options);
  };

  it("probes on with PAL timing and fast forward only when System Mode and CPU Speed cannot be read", async () => {
    const device = createFakeRemoteSeekDevice();
    device.api.getConfigItem = async () => {
      throw new Error("HTTP 503");
    };
    const found = await settle(probeRemoteTuneSeek(device.api, header(), 1));
    expect(found).toMatchObject({ timing: machineTimingFor("PAL"), cpuSpeedOptions: [] });
  });

  it("keeps probing while the title is on screen but the clock is not yet", async () => {
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

  it("abandons a jump that does not land in time and reports where it got to", async () => {
    const device = createFakeRemoteSeekDevice({ fastForwardRateByMhz: { 1: 2, 4: 2, 64: 2 } });
    const controller = new RemoteSidSeekController(device.api, profile());
    const landed = await settle(
      controller.jumpTo(() => 0, 600),
      120_000,
    );
    expect(landed?.completed).toBe(false);
    expect(landed?.seconds).toBeGreaterThan(30);
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
