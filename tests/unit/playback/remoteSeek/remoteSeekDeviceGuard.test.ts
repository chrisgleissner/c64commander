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
  readU64ConfigItem,
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
      "Vol Master=OFF (transient)",
      "key press arrow_left",
      "CPU Speed=64 (transient)",
      "key release arrow_left+minus+plus",
      "Vol Master=0 dB (restore)",
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
      "key release arrow_left+minus+plus",
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
    let pressOnWire: () => void = () => undefined;
    const onWire = new Promise<void>((resolve) => {
      pressOnWire = resolve;
    });
    const send = device.api.sendMachineInputBatch;
    device.api.sendMachineInputBatch = async (batch) => {
      if (batch.events[0]?.kind === "keyboard" && batch.events[0].transition === "press") {
        pressOnWire();
        await new Promise<void>((resolve) => {
          releasePress = resolve;
        });
      }
      return send(batch);
    };
    const session = await RemoteSeekDeviceSession.open(device.api);
    const press = session.pressKey();
    await onWire;
    const restore = session.restore("cancelled mid-press");
    releasePress();
    await press;
    await restore;
    expect(device.log).toEqual([
      "Vol Master=OFF (transient)",
      "key press arrow_left",
      "key release arrow_left+minus+plus",
      "Vol Master=0 dB (restore)",
    ]);
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

  it("treats an unreadable journal as empty and logs it", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    localStorage.setItem("c64u_remote_seek_device_journal_v1", "{not json");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    expect(addErrorLog).toHaveBeenCalledWith("Remote seek journal could not be read", expect.anything());
  });

  it("logs a journal it cannot write", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    const device = createFakeRemoteSeekDevice();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      await RemoteSeekDeviceSession.open(device.api);
    } finally {
      setItem.mockRestore();
    }
    expect(addErrorLog).toHaveBeenCalledWith("Remote seek journal could not be written", expect.anything());
  });

  it("reads config items in the app's own items shape, and names an item the device does not report", async () => {
    const device = createFakeRemoteSeekDevice();
    device.api.getConfigItem = async (category, item) =>
      ({ [category]: { items: { [item]: { selected: " 2" } } } }) as never;
    expect(await readU64ConfigItem(device.api, "CPU Speed")).toEqual({ value: " 2", options: [] });
    device.api.getConfigItem = async (category) => ({ [category]: {} }) as never;
    await expect(readU64ConfigItem(device.api, "CPU Speed")).rejects.toThrow(/CPU Speed is not reported/);
  });

  it("retries a restore while the device still reports the key held", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.pressKey();
    let reports = 0;
    const state = device.api.getMachineInputState;
    device.api.getMachineInputState = async () =>
      reports++ === 0 ? { keyboard: { inputs: ["arrow_left"] } } : state();
    vi.useFakeTimers();
    const restore = session.restore("released");
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await restore).toBe(true);
    expect(reports).toBe(2);
  });

  it("retries a restore whose read-back still shows the raised speed and Turbo Control", async () => {
    const device = createFakeRemoteSeekDevice({ settings: { "Turbo Control": "Off" } });
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed("64");
    const write = device.api.setConfigValue;
    let ignored = 0;
    device.api.setConfigValue = async (category, item, value, flags) =>
      flags?.__c64uTransientConfigRestore && ignored++ < 2 ? ({} as never) : write(category, item, value, flags);
    vi.useFakeTimers();
    const restore = session.restore("released");
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await restore).toBe(true);
    expect(device.settings).toMatchObject({ "CPU Speed": " 1", "Turbo Control": "Off" });
  });

  it("refuses to open a seek on a device that has not identified itself", async () => {
    const device = createFakeRemoteSeekDevice();
    device.connectTo(null);
    await expect(RemoteSeekDeviceSession.open(device.api)).rejects.toThrow(/not identified itself/);
    expect(await recoverRemoteSeekJournal(device.api, NO_RETRY_WAIT)).toBe(true);
  });

  it("refuses to open a new seek while an earlier one on the device cannot be undone", async () => {
    const device = createFakeRemoteSeekDevice();
    const earlier = await RemoteSeekDeviceSession.open(device.api);
    await earlier.setCpuSpeed("64");
    device.failures.keyEvents = 100;
    vi.useFakeTimers();
    const opening = RemoteSeekDeviceSession.open(device.api).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await opening).toBeInstanceOf(Error);
    device.failures.keyEvents = 0;
    vi.useFakeTimers();
    const again = RemoteSeekDeviceSession.open(device.api);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    await (await again).restore("done");
    expect(device.settings["CPU Speed"]).toBe(" 1");
  });

  it("refuses to open a new seek while a journal left by an earlier process cannot be undone", async () => {
    const device = createFakeRemoteSeekDevice();
    localStorage.setItem(
      "c64u_remote_seek_device_journal_v1",
      JSON.stringify({
        [DEVICE_KEY]: {
          sessionId: "earlier-process",
          deviceKey: DEVICE_KEY,
          originalCpuSpeed: " 1",
          cpuSpeedChanged: true,
          originalTurboControl: null,
          keyHeld: true,
          startedAtMs: 0,
        },
      }),
    );
    device.failures.keyEvents = 100;
    vi.useFakeTimers();
    const opening = RemoteSeekDeviceSession.open(device.api).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(String(await opening)).toMatch(/could not be undone/);
  });

  it("sends nothing for a CPU Speed the session already set", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed(" 1");
    expect(device.log).toEqual([]);
    await session.restore("done");
  });

  it("accepts an input state without a keyboard entry as nothing held", async () => {
    const device = createFakeRemoteSeekDevice();
    device.api.getMachineInputState = async () => ({});
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.pressKey();
    expect(await session.restore("released")).toBe(true);
  });

  it("keeps the journal when CPU Speed never reads back as it was", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.setCpuSpeed("64");
    const write = device.api.setConfigValue;
    device.api.setConfigValue = async (category, item, value, flags) =>
      flags?.__c64uTransientConfigRestore ? ({} as never) : write(category, item, value, flags);
    vi.useFakeTimers();
    const restore = session.restore("released");
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await restore).toBe(false);
    expect(addErrorLog).toHaveBeenCalledWith(
      "Remote seek could not restore the device; it will retry on the next connection",
      expect.objectContaining({ error: "Read-back after restore shows CPU Speed 64; expected  1" }),
    );
    device.api.setConfigValue = write;
    expect(await recoverRemoteSeekJournal(device.api, NO_RETRY_WAIT)).toBe(true);
  });

  it("puts Vol Master back after an app killed mid seek, on the next connection", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.pressKey();
    expect(device.settings["Vol Master"]).toBe("OFF");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({ originalMasterVolume: " 0 dB" });
    vi.resetModules();
    const fresh = await import("@/lib/playback/remoteSeek/remoteSeekDeviceGuard");
    expect(await fresh.recoverRemoteSeekJournal(device.api, NO_RETRY_WAIT)).toBe(true);
    expect(device.settings["Vol Master"]).toBe(" 0 dB");
    expect(device.player.heldKeys).toEqual([]);
    expect(fresh.readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
  });

  it("keeps the journal while Vol Master does not read back as it was", async () => {
    const device = createFakeRemoteSeekDevice();
    const session = await RemoteSeekDeviceSession.open(device.api);
    await session.pressKey();
    const write = device.api.setConfigValue;
    device.api.setConfigValue = async (category, item, value, options) =>
      item === "Vol Master" ? ({} as never) : write(category, item, value, options);
    expect(await session.restore("released")).toBe(false);
    expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({ originalMasterVolume: " 0 dB" });
  });

  describe("on a machine that takes no key input", () => {
    const openPatchSession = async (device: ReturnType<typeof createFakeRemoteSeekDevice>) =>
      RemoteSeekDeviceSession.open(device.api, {
        fastForward: { kind: "patch", ldyOperandAddress: device.player.code.ldyOperandAddress },
        withCpuSpeed: false,
      });
    const site = (device: ReturnType<typeof createFakeRemoteSeekDevice>) =>
      device.player.code.ldyOperandAddress.toString(16).toUpperCase().padStart(4, "0");

    it("holds fast forward through the player's routine, journals it, and gives it back without touching config", async () => {
      const device = createFakeRemoteSeekDevice({ cartridge: true });
      const session = await openPatchSession(device);
      await session.pressKey();
      expect(device.player.fastForwarding).toBe(true);
      expect(readRemoteSeekJournal(DEVICE_KEY)).toMatchObject({
        keyHeld: true,
        fastForwardPatch: { ldyOperandAddress: device.player.code.ldyOperandAddress },
      });
      expect(await session.restore("released")).toBe(true);
      expect(device.player.fastForwarding).toBe(false);
      expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
      expect(device.log).toEqual([`writemem ${site(device)} 01`, `writemem ${site(device)} 00`]);
    });

    it("undoes the patch an app killed mid hold left behind, on the next connection", async () => {
      const device = createFakeRemoteSeekDevice({ cartridge: true });
      const session = await openPatchSession(device);
      await session.pressKey();
      // The process dies here: its session is gone, its journal is not.
      vi.resetModules();
      const fresh = await import("@/lib/playback/remoteSeek/remoteSeekDeviceGuard");
      expect(await fresh.recoverRemoteSeekJournal(device.api, NO_RETRY_WAIT)).toBe(true);
      expect(device.player.fastForwarding).toBe(false);
      expect(fresh.readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    });

    it("leaves memory alone once the routine is no longer there, e.g. after another tune started", async () => {
      const device = createFakeRemoteSeekDevice({ cartridge: true });
      const session = await openPatchSession(device);
      await session.pressKey();
      device.player.writeMemory(device.player.code.ldyOperandAddress - 1, Uint8Array.of(0xea, 0xea));
      device.log.length = 0;
      expect(await session.restore("another tune")).toBe(true);
      expect(device.log).toEqual([]);
    });

    it("refuses to hold fast forward when the routine has moved since it was found", async () => {
      const device = createFakeRemoteSeekDevice({ cartridge: true });
      const session = await openPatchSession(device);
      device.player.writeMemory(device.player.code.ldyOperandAddress - 1, Uint8Array.of(0xea, 0xea));
      await expect(session.pressKey()).rejects.toThrow("no longer where it was found");
      expect(device.log).toEqual([]);
    });

    it("keeps the journal while the patch reads back as held", async () => {
      const device = createFakeRemoteSeekDevice({ cartridge: true });
      const session = await openPatchSession(device);
      await session.pressKey();
      device.api.writeMemory = async () => ({});
      expect(await session.restore("released")).toBe(false);
      expect(readRemoteSeekJournal(DEVICE_KEY)).not.toBeNull();
    });

    it("never sets CPU Speed on a machine without it", async () => {
      const device = createFakeRemoteSeekDevice({ cartridge: true });
      const session = await openPatchSession(device);
      await expect(session.setCpuSpeed("64")).rejects.toThrow("no CPU Speed");
    });
  });
});
