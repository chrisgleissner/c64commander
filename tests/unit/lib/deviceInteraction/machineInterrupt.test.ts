/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getC64API: vi.fn(() => ({ id: "api" })),
  getSelectedSavedDevice: vi.fn(() => ({ id: "device-a" })),
  getMachineExecutionSnapshot: vi.fn(() => ({ state: "paused", pauseMutePending: false })),
  restorePauseMuteFromPersistedSnapshot: vi.fn(async () => true),
  setMachineExecutionRunning: vi.fn(),
  publishMachineTakeover: vi.fn(async () => {}),
}));

vi.mock("@/lib/c64api", () => ({ getC64API: mocks.getC64API }));
vi.mock("@/lib/savedDevices/store", () => ({ getSelectedSavedDevice: mocks.getSelectedSavedDevice }));
vi.mock("@/lib/deviceInteraction/machineExecutionStore", () => ({
  getMachineExecutionSnapshot: mocks.getMachineExecutionSnapshot,
  restorePauseMuteFromPersistedSnapshot: mocks.restorePauseMuteFromPersistedSnapshot,
  setMachineExecutionRunning: mocks.setMachineExecutionRunning,
}));
vi.mock("@/lib/deviceInteraction/machineTakeoverEvent", () => ({
  publishMachineTakeover: mocks.publishMachineTakeover,
}));

import { publishMachineInterrupt } from "@/lib/deviceInteraction/machineInterrupt";

describe("publishMachineInterrupt (HARD19-031/032/011)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockClear());
    mocks.getMachineExecutionSnapshot.mockReturnValue({ state: "paused", pauseMutePending: false });
  });

  it("marks the machine running and publishes the takeover (no pending pause-mute)", async () => {
    await publishMachineInterrupt({ reason: "home-reset", label: "Reset" });

    expect(mocks.setMachineExecutionRunning).toHaveBeenCalledTimes(1);
    expect(mocks.restorePauseMuteFromPersistedSnapshot).not.toHaveBeenCalled();
    expect(mocks.publishMachineTakeover).toHaveBeenCalledWith({ reason: "home-reset", label: "Reset" });
  });

  it("restores a pending pause-mute so a reset-while-paused does not strand the SID mixer muted (HARD19-032)", async () => {
    mocks.getMachineExecutionSnapshot.mockReturnValue({ state: "paused", pauseMutePending: true });

    await publishMachineInterrupt({ reason: "home-reset", label: "Reset" });

    expect(mocks.restorePauseMuteFromPersistedSnapshot).toHaveBeenCalledWith({ id: "api" }, "device-a");
    expect(mocks.setMachineExecutionRunning).toHaveBeenCalledTimes(1);
    expect(mocks.publishMachineTakeover).toHaveBeenCalledTimes(1);
  });

  it("keeps the machine paused (no running flip, no mixer restore) but still publishes the takeover when endsPaused", async () => {
    mocks.getMachineExecutionSnapshot.mockReturnValue({ state: "paused", pauseMutePending: true });

    await publishMachineInterrupt({ reason: "home-reset", label: "Snapshot restore", endsPaused: true });

    expect(mocks.setMachineExecutionRunning).not.toHaveBeenCalled();
    expect(mocks.restorePauseMuteFromPersistedSnapshot).not.toHaveBeenCalled();
    expect(mocks.publishMachineTakeover).toHaveBeenCalledWith({
      reason: "home-reset",
      label: "Snapshot restore",
    });
  });

  it("flips the execution state synchronously (before the first await) for fire-and-forget callers", () => {
    mocks.getMachineExecutionSnapshot.mockReturnValue({ state: "paused", pauseMutePending: false });

    // Do not await: the synchronous prefix of the async function must have run.
    void publishMachineInterrupt({ reason: "home-reset", label: "Reset" });

    expect(mocks.setMachineExecutionRunning).toHaveBeenCalledTimes(1);
  });
});
