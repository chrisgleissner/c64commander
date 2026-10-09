/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRemoteSeekJournal, RemoteSeekDeviceSession } from "@/lib/playback/remoteSeek/remoteSeekDeviceGuard";
import { createFakeRemoteSeekDevice, DEVICE_KEY } from "./fakeRemoteSeekDevice";

const connection = vi.hoisted(() => ({
  state: "OFFLINE_NO_DEMO",
  simulated: false,
  listeners: new Set<() => void>(),
}));
const device = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeRemoteSeekDevice> | null }));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: connection.state }),
  isSimulatedDeviceTarget: () => connection.simulated,
  subscribeConnection: (listener: () => void) => {
    connection.listeners.add(listener);
    return () => connection.listeners.delete(listener);
  },
}));
vi.mock("@/lib/playback/remoteSeek/activeRemoteSidSeek", () => ({ createRemoteSeekApi: () => device.current?.api }));

import { installRemoteSeekRecovery } from "@/lib/playback/remoteSeek/remoteSeekRecovery";

const connect = (state: string) => {
  connection.state = state;
  connection.listeners.forEach((listener) => listener());
};

/**
 * A seek cut off with the key down at 64 MHz, as a killed app leaves it: the device in that state
 * and the journal the earlier process wrote, with no session of this process owning it.
 */
const leaveUnfinishedSeek = async () => {
  await device.current!.api.sendMachineInputBatch({
    events: [{ kind: "keyboard", inputs: ["arrow_left"], transition: "press" }],
  });
  await device.current!.api.setConfigValue("U64 Specific Settings", "CPU Speed", "64");
  const journal = {
    sessionId: "earlier-process",
    deviceKey: DEVICE_KEY,
    originalCpuSpeed: " 1",
    cpuSpeedChanged: true,
    originalTurboControl: null,
    keyHeld: true,
    startedAtMs: 0,
  };
  localStorage.setItem("c64u_remote_seek_device_journal_v1", JSON.stringify({ [DEVICE_KEY]: journal }));
};

describe("remote seek recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    connection.state = "OFFLINE_NO_DEMO";
    connection.simulated = false;
    connection.listeners.clear();
    device.current = createFakeRemoteSeekDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores a device left mid seek once the app reaches it again", async () => {
    await leaveUnfinishedSeek();
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    await vi.runAllTimersAsync();
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    uninstall();
  });

  it("restores at install time when the app is already connected", async () => {
    await leaveUnfinishedSeek();
    connection.state = "REAL_CONNECTED";
    const uninstall = installRemoteSeekRecovery();
    await vi.runAllTimersAsync();
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    uninstall();
  });

  it("leaves the journal alone on a simulated device, which is not the machine that owes it", async () => {
    await leaveUnfinishedSeek();
    connection.simulated = true;
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    await vi.runAllTimersAsync();
    expect(device.current!.settings["CPU Speed"]).toBe("64");
    expect(readRemoteSeekJournal(DEVICE_KEY)).not.toBeNull();
    uninstall();
  });

  it("does nothing while the connection is not up", async () => {
    await leaveUnfinishedSeek();
    const uninstall = installRemoteSeekRecovery();
    connect("DISCOVERING");
    await vi.runAllTimersAsync();
    expect(device.current!.settings["CPU Speed"]).toBe("64");
    uninstall();
    connect("REAL_CONNECTED");
    await vi.runAllTimersAsync();
    expect(device.current!.settings["CPU Speed"]).toBe("64");
  });

  it("leaves the journal of a seek this app is still running to that seek", async () => {
    const session = await RemoteSeekDeviceSession.open(device.current!.api);
    await session.pressKey();
    await session.setCpuSpeed("64");
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    await vi.runAllTimersAsync();
    expect(device.current!.settings["CPU Speed"]).toBe("64");
    expect(readRemoteSeekJournal(DEVICE_KEY)).not.toBeNull();
    await session.restore("released");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    uninstall();
  });

  it("runs one recovery at a time and logs a recovery that throws", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    await leaveUnfinishedSeek();
    device.current!.api.currentDeviceKey = () => {
      throw new Error("identity unavailable");
    };
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    connect("DISCOVERING");
    connect("REAL_CONNECTED");
    await vi.runAllTimersAsync();
    expect(addErrorLog).toHaveBeenCalledTimes(1);
    expect(addErrorLog).toHaveBeenCalledWith("Remote seek recovery failed", expect.anything());
    uninstall();
  });
});
