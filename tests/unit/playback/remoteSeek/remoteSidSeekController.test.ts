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
import { SIMULATED_SCREEN_ADDRESS } from "../../../mocks/sidPlayerSimulation";
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
    await settle(controller.beginFastForward(0, (position) => positions.push(position)));
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
    expect(Math.abs((landed ?? 0) - device.player.tunePositionSeconds)).toBeLessThan(1.5);
    expect(positions.length).toBeGreaterThan(10);
    expect(positions[positions.length - 1]).toBeGreaterThan(300);
  });

  it("ends a fast forward held past the hold limit by itself", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.beginFastForward(0, () => undefined));
    await vi.advanceTimersByTimeAsync(FAST_FORWARD_MAX_HOLD_MS + 5000);
    expect(controller.isFastForwarding).toBe(false);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("jumps forward to within a second of the target and leaves the device as it was", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const landed = await settle(controller.jumpTo(0, 200));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(199.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(201.5);
    expect(landed).toBeGreaterThanOrEqual(200);
    expect(device.player.restarts).toBe(0);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(cpuSpeedWrites(device.log)).toEqual(["64 (transient)", "4 (transient)", "1 (transient)", "1 (restore)"]);
  });

  it("releases the key before every CPU Speed change, so a late write cannot overshoot", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(0, 200));
    device.log.forEach((entry, index) => {
      if (entry.startsWith("CPU Speed=") && index > 0) {
        const lastKey = device.log
          .slice(0, index)
          .reverse()
          .find((earlier) => earlier.startsWith("key "));
        expect(lastKey ?? "key release arrow_left").toBe("key release arrow_left");
      }
    });
  });

  it("rewinds by restarting the sub tune and fast forwarding to the target", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.jumpTo(0, 150));
    const landed = await settle(controller.jumpTo(150, 40));
    expect(device.player.restarts).toBe(2);
    expect(device.log).toEqual(expect.arrayContaining(["key press minus", "key release minus", "key press plus"]));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(39.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(41.5);
    expect(landed).toBeGreaterThanOrEqual(40);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("lands an NTSC tune on a PAL machine on the music's position, not the faster clock", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 60 });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: 60 }));
    await settle(controller.jumpTo(0, 120));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(119.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(121.5);
  });

  it("measures a CIA-timed tune's play-call rate from the timer before it jumps", async () => {
    const device = createFakeRemoteSeekDevice({ playCallHz: 200 });
    const controller = new RemoteSidSeekController(device.api, profile({ headerPlayCallHz: null }));
    await settle(controller.jumpTo(0, 60));
    expect(device.player.tunePositionSeconds).toBeGreaterThanOrEqual(59.5);
    expect(device.player.tunePositionSeconds).toBeLessThan(61.5);
  });

  it("gives the device back when a jump is cancelled half way", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    const jump = controller.jumpTo(0, 1000);
    await vi.advanceTimersByTimeAsync(300);
    await settle(controller.cancel("stop"));
    expect(await settle(jump)).toBeNull();
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
  });

  it("gives the device back when the fast forward is cancelled while Next is held", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    await settle(controller.beginFastForward(0, () => undefined));
    await vi.advanceTimersByTimeAsync(3000);
    await settle(controller.cancel("pause"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(device.player.heldKeys).toEqual([]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(controller.isFastForwarding).toBe(false);
  });

  it("does not jump back on a machine without CPU Speed", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile({ cpuSpeedOptions: [] }));
    expect(controller.canRewind).toBe(false);
    expect(await settle(controller.jumpTo(100, 10))).toBeNull();
    expect(device.log).toEqual([]);
  });

  it("restores the device when a jump fails part way, and reports no position", async () => {
    const device = createFakeRemoteSeekDevice();
    const controller = new RemoteSidSeekController(device.api, profile());
    device.failures.keyEvents = 1;
    expect(await settle(controller.jumpTo(0, 200))).toBeNull();
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
