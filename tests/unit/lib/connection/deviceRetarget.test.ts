/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasActiveInputRelease: vi.fn(() => true),
  releaseActiveRemoteInput: vi.fn(async () => {}),
  clearToastsOnDeviceSwitch: vi.fn(),
  setHealthCheckStateSnapshot: vi.fn(),
  resetMachineExecution: vi.fn(),
  isBackgroundExecutionActive: vi.fn(() => true),
  stopBackgroundExecution: vi.fn(async () => {}),
  setDueAtMs: vi.fn(async () => {}),
  getSavedDeviceById: vi.fn((id: string) => ({ id, host: `${id}.local` })),
  getRegisteredQueryClient: vi.fn(() => ({ id: "query-client" })),
  invalidateForSavedDeviceSwitch: vi.fn(),
  toast: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/remoteInput/activeInputRelease", () => ({
  hasActiveInputRelease: mocks.hasActiveInputRelease,
  releaseActiveRemoteInput: mocks.releaseActiveRemoteInput,
}));
vi.mock("@/lib/uiErrors", () => ({ clearToastsOnDeviceSwitch: mocks.clearToastsOnDeviceSwitch }));
vi.mock("@/lib/diagnostics/healthCheckState", () => ({
  setHealthCheckStateSnapshot: mocks.setHealthCheckStateSnapshot,
}));
vi.mock("@/lib/deviceInteraction/machineExecutionStore", () => ({
  resetMachineExecution: mocks.resetMachineExecution,
}));
vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  isBackgroundExecutionActive: mocks.isBackgroundExecutionActive,
  stopBackgroundExecution: mocks.stopBackgroundExecution,
}));
vi.mock("@/lib/native/backgroundExecution", () => ({ BackgroundExecution: { setDueAtMs: mocks.setDueAtMs } }));
vi.mock("@/lib/savedDevices/store", () => ({ getSavedDeviceById: mocks.getSavedDeviceById }));
vi.mock("@/lib/query/queryClientRegistry", () => ({ getRegisteredQueryClient: mocks.getRegisteredQueryClient }));
vi.mock("@/lib/query/c64QueryInvalidation", () => ({
  invalidateForSavedDeviceSwitch: mocks.invalidateForSavedDeviceSwitch,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/logging", () => ({ addLog: mocks.addLog }));

import { prepareForDeviceRetarget } from "@/lib/connection/deviceRetarget";

describe("prepareForDeviceRetarget (HARD19-012)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockClear());
    mocks.hasActiveInputRelease.mockReturnValue(true);
    mocks.isBackgroundExecutionActive.mockReturnValue(true);
    mocks.getSavedDeviceById.mockImplementation((id: string) => ({ id, host: `${id}.local` }));
    mocks.getRegisteredQueryClient.mockReturnValue({ id: "query-client" });
  });

  it("runs every cross-device hygiene step on a real device change", async () => {
    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.releaseActiveRemoteInput).toHaveBeenCalledTimes(1);
    expect(mocks.clearToastsOnDeviceSwitch).toHaveBeenCalledWith("device-a.local");
    expect(mocks.setHealthCheckStateSnapshot).toHaveBeenCalledWith({ latestResult: null });
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
    expect(mocks.stopBackgroundExecution).toHaveBeenCalledTimes(1);
    expect(mocks.setDueAtMs).toHaveBeenCalledWith({ dueAtMs: null });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Playback controls detached" }));
    expect(mocks.invalidateForSavedDeviceSwitch).toHaveBeenCalledWith({ id: "query-client" });
  });

  it("skips remote-input release when nothing is holding input", async () => {
    mocks.hasActiveInputRelease.mockReturnValue(false);

    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.releaseActiveRemoteInput).not.toHaveBeenCalled();
    // The rest of the hygiene still runs.
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
  });

  it("does not clear toasts/health when there is no distinct previous device (cold start)", async () => {
    await prepareForDeviceRetarget(null, "device-b");

    expect(mocks.clearToastsOnDeviceSwitch).not.toHaveBeenCalled();
    expect(mocks.setHealthCheckStateSnapshot).not.toHaveBeenCalled();
    // Machine-execution reset is device-agnostic and still runs.
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
    // No background stop without a previous device.
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
  });

  it("does not treat retargeting to the same device id as a device change", async () => {
    await prepareForDeviceRetarget("device-a", "device-a");

    expect(mocks.clearToastsOnDeviceSwitch).not.toHaveBeenCalled();
    expect(mocks.setHealthCheckStateSnapshot).not.toHaveBeenCalled();
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
  });

  it("skips the background-execution stop when nothing is running", async () => {
    mocks.isBackgroundExecutionActive.mockReturnValue(false);

    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(mocks.setDueAtMs).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("skips query invalidation when no query client is registered yet (pre-UI startup)", async () => {
    mocks.getRegisteredQueryClient.mockReturnValue(null);

    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.invalidateForSavedDeviceSwitch).not.toHaveBeenCalled();
    // Everything else still runs.
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
  });

  it("still completes hygiene when a native stop step rejects", async () => {
    mocks.stopBackgroundExecution.mockRejectedValueOnce(new Error("native down"));

    await expect(prepareForDeviceRetarget("device-a", "device-b")).resolves.toBeUndefined();

    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateForSavedDeviceSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.addLog).toHaveBeenCalled();
  });
});
