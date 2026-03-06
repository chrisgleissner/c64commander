import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  addLog: vi.fn(),
  getLifecycleState: vi.fn(() => "active"),
  classifyError: vi.fn(() => ({
    failureClass: "plugin-failure",
    category: "integration",
  })),
}));

vi.mock("@/lib/native/backgroundExecution", () => ({
  BackgroundExecution: {
    start: mocks.start,
    stop: mocks.stop,
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
}));

vi.mock("@/lib/appLifecycle", () => ({
  getLifecycleState: mocks.getLifecycleState,
}));

vi.mock("@/lib/tracing/failureTaxonomy", () => ({
  classifyError: mocks.classifyError,
}));

import {
  resetBackgroundExecutionState,
  startBackgroundExecution,
  stopBackgroundExecution,
} from "@/lib/native/backgroundExecutionManager";

describe("backgroundExecutionManager", () => {
  beforeEach(() => {
    resetBackgroundExecutionState();
    mocks.start.mockReset();
    mocks.stop.mockReset();
    mocks.addLog.mockReset();
    mocks.getLifecycleState.mockReturnValue("active");
    mocks.classifyError.mockReturnValue({
      failureClass: "plugin-failure",
      category: "integration",
    });
  });

  afterEach(() => {
    resetBackgroundExecutionState();
  });

  it("logs error and throws when background start fails", async () => {
    mocks.start.mockRejectedValueOnce(new Error("start-failed"));

    await expect(
      startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
      }),
    ).rejects.toThrow("Background execution start failed: start-failed");

    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution start failed",
      expect.objectContaining({
        source: "playback-controller",
        reason: "play",
        lifecycleState: "active",
        failureClass: "plugin-failure",
        failureCategory: "integration",
        error: "start-failed",
      }),
    );
  });

  it("logs error and throws when background stop fails", async () => {
    mocks.stop.mockRejectedValueOnce(new Error("stop-failed"));

    await startBackgroundExecution({
      source: "playback-controller",
      reason: "play",
    });
    await expect(
      stopBackgroundExecution({
        source: "playback-controller",
        reason: "pause",
      }),
    ).rejects.toThrow("Background execution stop failed: stop-failed");

    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution stop failed",
      expect.objectContaining({
        source: "playback-controller",
        reason: "pause",
        lifecycleState: "active",
        failureClass: "plugin-failure",
        failureCategory: "integration",
        error: "stop-failed",
      }),
    );
  });

  it("uses reference counting to avoid duplicate native starts and stops", async () => {
    await startBackgroundExecution({
      source: "playback-controller",
      reason: "play",
    });
    await startBackgroundExecution({
      source: "playback-controller",
      reason: "play",
    });
    expect(mocks.start).toHaveBeenCalledTimes(1);

    await stopBackgroundExecution({
      source: "playback-controller",
      reason: "pause",
    });
    expect(mocks.stop).not.toHaveBeenCalled();

    await stopBackgroundExecution({
      source: "playback-controller",
      reason: "stop",
    });
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("normalizes non-Error failures when start rejects", async () => {
    mocks.start.mockRejectedValueOnce("string-failure");

    await expect(
      startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
      }),
    ).rejects.toThrow("Background execution start failed: string-failure");

    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution start failed",
      expect.objectContaining({
        error: "string-failure",
      }),
    );
  });
});
