/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A remote seek borrows the left-arrow key and CPU Speed. These tests hold the guarantee that both
 * are given back: recorded before the first change, restored in a safe order, confirmed by reading
 * them back, and replayed on the next connection when anything cut the restore off.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readRemoteSeekJournal,
  recoverRemoteSeekJournal,
  restoreFromJournal,
  RemoteSeekDeviceSession,
  RemoteSeekSessionClosedError,
} from "@/lib/playback/remoteSeek/remoteSeekDeviceGuard";
import { createFakeRemoteSeekDevice, DEVICE_KEY } from "./fakeRemoteSeekDevice";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

const NO_RETRY_WAIT = [0, 0, 0, 0];

describe("remote seek device guard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records the original CPU Speed before it changes anything", async () => {
    const device = createFakeRemoteSeekDevice({ settings: { "CPU Speed": " 2" } });
    const session = await RemoteSeekDeviceSession.open(device.api);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({ originalCpuSpeed: " 2", keyHeld: false });
    expect(device.log).toEqual([]);
    await session.setCpuSpeed("64");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({ originalCpuSpeed: " 2", cpuSpeedChanged: true });
  });

  it("releases the key before it puts CPU Speed back, and clears the journal only after reading it back", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.pressKey();
    await session.setCpuSpeed("64");
    expect(await session.restore("test")).toBe(true);
    expect(device.log).toEqual([
      "key press arrow_left",
      "CPU Speed=64 (transient)",
      "key release arrow_left",
      "CPU Speed=1 (restore)",
    ]);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(device.player.heldKeys).toEqual([]);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
  });

  it("switches Turbo Control from Off to Manual for the seek and back to Off afterwards", async () => {
    const device = createFakeRemoteSeekDevice({ settings: { "Turbo Control": "Off" } });
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed("64");
    await session.restore("test");
    expect(device.log).toEqual([
      "Turbo Control=Manual (transient)",
      "CPU Speed=64 (transient)",
      "key release arrow_left",
      "CPU Speed=1 (restore)",
      "Turbo Control=Off (restore)",
    ]);
    expect(device.settings["Turbo Control"]).toBe("Off");
  });

  it("does not touch Turbo Control when it is already Manual", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed(" 4");
    await session.restore("test");
    expect(device.log.some((entry) => entry.startsWith("Turbo Control"))).toBe(false);
  });

  it("retries a failed restore and succeeds once the device answers again", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed("64");
    device.failures.configWrites = 2;
    vi.useFakeTimers();
    const restore = session.restore("test");
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await restore).toBe(true);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
  });

  it("keeps the journal when every restore attempt fails, and the next connection restores the device", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.pressKey();
    await session.setCpuSpeed("64");
    device.failures.keyEvents = 100;
    vi.useFakeTimers();
    const restore = session.restore("connection lost");
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await restore).toBe(false);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({ originalCpuSpeed: " 1", keyHeld: true });
    expect(device.settings["CPU Speed"]).toBe("64");

    device.failures.keyEvents = 0;
    expect(await recoverRemoteSeekJournal(device.api, NO_RETRY_WAIT)).toBe(true);
    expect(device.settings["CPU Speed"]).toBe(" 1");
    expect(device.player.heldKeys).toEqual([]);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
  });

  it("never restores a journal onto a different device", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed("64");
    device.connectTo(JSON.stringify(["f13e69", "u2"]));
    expect(await session.restore("device switched")).toBe(false);
    expect(device.log).toEqual(["CPU Speed=64 (transient)"]);
    expect(await recoverRemoteSeekJournal(device.api, NO_RETRY_WAIT)).toBe(true);
    expect(readRemoteSeekJournal(DEVICE_KEY)).not.toBeNull();

    device.connectTo(DEVICE_KEY);
    expect(await recoverRemoteSeekJournal(device.api, NO_RETRY_WAIT)).toBe(true);
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("refuses to press the key or change CPU Speed once a restore has begun", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    const restore = session.restore("cancelled");
    expect(() => session.pressKey()).toThrow(RemoteSeekSessionClosedError);
    expect(() => session.setCpuSpeed("64")).toThrow(RemoteSeekSessionClosedError);
    await restore;
    expect(device.player.heldKeys).toEqual([]);
  });

  it("waits for a key press already on the wire before it releases the key", async () => {
    const device = createFakeRemoteSeekDevice();
    let releasePress: () => void = () => undefined;
    const send = device.api.sendMachineInputBatch;
    device.api.sendMachineInputBatch = async (batch) => {
      if (batch.events[0]?.kind === "keyboard" && batch.events[0].transition === "press") {
        await new Promise<void>((resolve) => {
          releasePress = resolve;
        });
      }
      return send(batch);
    };
    const session = await RemoteSeekDeviceSession.open(device.api);
    const press = session.pressKey();
    const restore = session.restore("cancelled mid-press");
    releasePress();
    await press;
    await restore;
    expect(device.log).toEqual(["key press arrow_left", "key release arrow_left"]);
    expect(device.player.heldKeys).toEqual([]);
  });

  it("replays an unfinished journal before opening a new seek on the same device", async () => {
    const device = createFakeRemoteSeekDevice();
    const first = await RemoteSeekDeviceSession.open(device.api);
    await first.setCpuSpeed("64");
    const second = await RemoteSeekDeviceSession.open(device.api);
    expect(second.originalCpuSpeed).toBe(" 1");
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("marks every write it makes as transient, so a flash save can never keep a seek's CPU Speed", async () => {
    const device = createFakeRemoteSeekDevice({ settings: { "Turbo Control": "Off" } });
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed("64");
    await session.restore("test");
    const writes = device.log.filter((entry) => entry.includes("="));
    expect(writes.every((entry) => entry.endsWith("(transient)") || entry.endsWith("(restore)"))).toBe(true);
  });

  it("refuses to change anything once the app talks to a different device", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    device.connectTo(JSON.stringify(["f13e69", "u2"]));
    expect(() => session.setCpuSpeed("64")).toThrow(RemoteSeekSessionClosedError);
    expect(() => session.pressKey()).toThrow(RemoteSeekSessionClosedError);
    await session.releaseKey();
    expect(device.log).toEqual([]);
    device.connectTo(DEVICE_KEY);
    expect(await session.restore("back on the device")).toBe(true);
  });

  it("does not clear a newer session's journal when an older restore completes", async () => {
    const device = createFakeRemoteSeekDevice();
    const stale = {
      sessionId: "earlier-process",
      deviceKey: DEVICE_KEY,
      originalCpuSpeed: " 1",
      cpuSpeedChanged: false,
      originalTurboControl: null,
      keyHeld: true,
      startedAtMs: 0,
    };
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed("64");
    expect(await restoreFromJournal(device.api, stale, "late", NO_RETRY_WAIT)).toBe(true);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({ cpuSpeedChanged: true, originalCpuSpeed: " 1" });
    await session.restore("released");
  });
});
