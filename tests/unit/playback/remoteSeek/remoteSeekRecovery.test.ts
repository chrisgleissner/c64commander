/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readRemoteSeekJournal,
  REMOTE_SEEK_JOURNAL_MAX_AGE_MS,
  RemoteSeekDeviceSession,
} from "@/lib/playback/remoteSeek/remoteSeekDeviceGuard";
import { createFakeRemoteSeekDevice, DEVICE_KEY } from "./fakeRemoteSeekDevice";

const connection = vi.hoisted(() => ({
  state: "OFFLINE_NO_DEMO",
  simulated: false,
  listeners: new Set<() => void>(),
}));
const device = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeRemoteSeekDevice> | null }));

/** The SID player is on screen: what the controller confirms before every key. */
const ON_SCREEN = async () => true;

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
const leaveUnfinishedSeek = async (startedAtMs = Date.now()) => {
  device.current!.player.pressKey("arrow_left");
  await device.current!.api.setConfigValue("U64 Specific Settings", "CPU Speed", "64");
  const journal = {
    sessionId: "earlier-process",
    deviceKey: DEVICE_KEY,
    originalCpuSpeed: " 1",
    cpuSpeedChanged: true,
    originalTurboControl: null,
    keyHeld: true,
    startedAtMs,
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
    const session = await RemoteSeekDeviceSession.open(device.current!.api, { playerOnScreen: ON_SCREEN });
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

  it("logs a recovery that throws, and runs again for a connection made while it ran", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    vi.mocked(addErrorLog).mockClear();
    await leaveUnfinishedSeek();
    const identify = device.current!.api.currentDeviceKey;
    device.current!.api.currentDeviceKey = () => {
      throw new Error("identity unavailable");
    };
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    connect("DISCOVERING");
    connect("REAL_CONNECTED");
    await vi.advanceTimersByTimeAsync(1600);
    device.current!.api.currentDeviceKey = identify;
    await vi.advanceTimersByTimeAsync(5000);
    expect(addErrorLog).toHaveBeenCalledTimes(1);
    expect(addErrorLog).toHaveBeenCalledWith("Remote seek recovery failed", expect.anything());
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    uninstall();
  });

  it("tries a failed restore again while the app stays connected, then leaves it to the next connection", async () => {
    await leaveUnfinishedSeek();
    const write = device.current!.api.setConfigValue;
    let refusing = true;
    device.current!.api.setConfigValue = async (...args) => {
      if (refusing) throw new Error("Request timed out");
      return write(...args);
    };
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(device.current!.settings["CPU Speed"]).toBe("64");
    refusing = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    uninstall();
  });

  it("tries again a seek's own restore that failed while the app stays connected", async () => {
    connection.state = "REAL_CONNECTED";
    const uninstall = installRemoteSeekRecovery();
    const session = await RemoteSeekDeviceSession.open(device.current!.api, { playerOnScreen: ON_SCREEN });
    await session.setCpuSpeed("64");
    const write = device.current!.api.setConfigValue;
    let refusing = true;
    device.current!.api.setConfigValue = async (...args) => {
      if (refusing) throw new Error("Request timed out");
      return write(...args);
    };
    const restore = session.restore("released");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await restore).toBe(false);
    refusing = false;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    uninstall();
  });

  it("tries again a recovery that threw while the app stays connected", async () => {
    await leaveUnfinishedSeek();
    const identify = device.current!.api.currentDeviceKey;
    device.current!.api.currentDeviceKey = () => {
      throw new Error("identity unavailable");
    };
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    await vi.advanceTimersByTimeAsync(5000);
    device.current!.api.currentDeviceKey = identify;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    uninstall();
  });

  it("stops trying a restore that keeps failing, so a dead device is not polled for ever", async () => {
    await leaveUnfinishedSeek();
    const setConfigValue = vi.fn(async () => {
      throw new Error("Request timed out");
    });
    device.current!.api.setConfigValue = setConfigValue;
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    await vi.advanceTimersByTimeAsync(3_600_000);
    const attempts = setConfigValue.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(setConfigValue.mock.calls.length).toBe(attempts);
    expect(attempts).toBeGreaterThan(0);
    uninstall();
  });

  it("drops a journal too old to replay instead of overwriting settings chosen since", async () => {
    await leaveUnfinishedSeek(Date.now() - REMOTE_SEEK_JOURNAL_MAX_AGE_MS - 1);
    const uninstall = installRemoteSeekRecovery();
    connect("REAL_CONNECTED");
    await vi.runAllTimersAsync();
    expect(device.current!.settings["CPU Speed"]).toBe("64");
    expect(readRemoteSeekJournal(DEVICE_KEY)).toBeNull();
    uninstall();
  });
});
