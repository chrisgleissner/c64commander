/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { addErrorLog, isBackgroundExecutionActive, stopBackgroundExecution } = vi.hoisted(() => ({
  addErrorLog: vi.fn(),
  isBackgroundExecutionActive: vi.fn(),
  stopBackgroundExecution: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog,
}));

vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  isBackgroundExecutionActive,
  stopBackgroundExecution,
}));

import { publishMachineTakeover, subscribeMachineTakeover } from "@/lib/deviceInteraction/machineTakeoverEvent";

describe("machineTakeoverEvent", () => {
  beforeEach(() => {
    addErrorLog.mockClear();
    isBackgroundExecutionActive.mockReset();
    stopBackgroundExecution.mockReset();
  });

  it("isolates a throwing listener so remaining listeners still run and the error is logged", async () => {
    const throwing = vi.fn(() => {
      throw new Error("listener boom");
    });
    const healthy = vi.fn();
    const unsubscribeThrowing = subscribeMachineTakeover(throwing);
    const unsubscribeHealthy = subscribeMachineTakeover(healthy);
    isBackgroundExecutionActive.mockReturnValue(false);

    await expect(
      publishMachineTakeover({ reason: "home-reset", label: "Home reset" }),
    ).resolves.toBeUndefined();

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(addErrorLog).toHaveBeenCalledWith(
      "Machine takeover listener threw",
      expect.objectContaining({ reason: "home-reset", label: "Home reset", error: "listener boom" }),
    );

    unsubscribeThrowing();
    unsubscribeHealthy();
  });

  it("still stops an orphaned background-execution session unconditionally when a listener throws", async () => {
    const throwing = vi.fn(() => {
      throw new Error("listener boom");
    });
    const unsubscribe = subscribeMachineTakeover(throwing);
    isBackgroundExecutionActive.mockReturnValue(true);
    stopBackgroundExecution.mockResolvedValue(undefined);

    await publishMachineTakeover({ reason: "external-launch", label: "demo.prg" });

    expect(stopBackgroundExecution).toHaveBeenCalledWith({
      source: "machine-takeover",
      reason: "external-launch",
    });

    unsubscribe();
  });

  it("logs (rather than throwing) when stopping the orphaned background-execution session itself fails", async () => {
    isBackgroundExecutionActive.mockReturnValue(true);
    stopBackgroundExecution.mockRejectedValue(new Error("stop failed"));

    await expect(
      publishMachineTakeover({ reason: "home-reset", label: "Home reset" }),
    ).resolves.toBeUndefined();

    expect(addErrorLog).toHaveBeenCalledWith(
      "Failed to stop background execution after machine takeover",
      expect.objectContaining({ reason: "home-reset", label: "Home reset", error: "stop failed" }),
    );
  });
});
