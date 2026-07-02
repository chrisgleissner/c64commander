import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIndexedSliderDomain,
  createNumericSliderDomain,
  useDeviceBoundSlider,
} from "@/hooks/useDeviceBoundSlider";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";

const mockSliderContext = vi.hoisted(() => ({
  selectedDeviceId: "device-a",
}));
const mockSafetyConfig = vi.hoisted(() => ({
  current: {
    mode: "BALANCED",
    ftpMaxConcurrency: 2,
    infoCacheMs: 600,
    configsCacheMs: 1000,
    configsCooldownMs: 500,
    drivesCooldownMs: 500,
    ftpListCooldownMs: 300,
    telnetConnectCooldownMs: 300,
    backoffBaseMs: 200,
    backoffMaxMs: 3000,
    backoffFactor: 1.8,
    circuitBreakerThreshold: 4,
    circuitBreakerCooldownMs: 4000,
    discoveryProbeIntervalMs: 700,
    allowUserOverrideCircuit: true,
  },
}));
const addLogMock = vi.hoisted(() => vi.fn());

const createDeferred = () => {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

vi.mock("@/hooks/useSavedDevices", () => ({
  useSavedDevices: () => ({
    selectedDeviceId: mockSliderContext.selectedDeviceId,
  }),
}));

vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: () => mockSafetyConfig.current,
}));

vi.mock("@/lib/logging", () => ({
  addLog: addLogMock,
}));

describe("useDeviceBoundSlider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSliderContext.selectedDeviceId = "device-a";
    mockSafetyConfig.current = {
      mode: "BALANCED",
      ftpMaxConcurrency: 2,
      infoCacheMs: 600,
      configsCacheMs: 1000,
      configsCooldownMs: 500,
      drivesCooldownMs: 500,
      ftpListCooldownMs: 300,
      telnetConnectCooldownMs: 300,
      backoffBaseMs: 200,
      backoffMaxMs: 3000,
      backoffFactor: 1.8,
      circuitBreakerThreshold: 4,
      circuitBreakerCooldownMs: 4000,
      discoveryProbeIntervalMs: 700,
      allowUserOverrideCircuit: true,
    };
    pollingPauseRegistry.__resetForTest();
    addLogMock.mockClear();
  });

  afterEach(() => {
    pollingPauseRegistry.__resetForTest();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("supports indexed sliders with immediate local draft and commit reconciliation", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ deviceValue }) =>
        useDeviceBoundSlider({
          deviceValue,
          domain: createIndexedSliderDomain([" 1", " 2", " 4"] as const),
          previewMode: "commitOnly",
          commit,
        }),
      {
        initialProps: { deviceValue: " 1" as const },
      },
    );

    act(() => {
      result.current.onValueChange([2]);
    });
    expect(result.current.sliderValue).toBe(2);
    expect(result.current.displayValue).toBe(" 4");

    act(() => {
      result.current.onValueCommit([2]);
    });
    expect(commit).toHaveBeenCalledWith(" 4");
    expect(result.current.isAwaitingReconciliation).toBe(true);
    expect(result.current.displayValue).toBe(" 4");

    rerender({ deviceValue: "4" as const });
    expect(result.current.isAwaitingReconciliation).toBe(false);
    expect(result.current.sliderValue).toBe(2);
  });

  it("commits the last displayed draft value when the release event rounds to a neighboring step", () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 20,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "commitOnly",
        commit,
      }),
    );

    act(() => {
      result.current.onValueChange([23]);
    });
    expect(result.current.sliderValue).toBe(23);

    act(() => {
      result.current.onValueCommit([24]);
    });

    expect(commit).toHaveBeenCalledWith(23);
    expect(result.current.sliderValue).toBe(23);
    expect(result.current.isAwaitingReconciliation).toBe(true);
  });

  it("commits the latest draft value when change and commit happen in the same turn", () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: " 1",
        domain: createIndexedSliderDomain([" 1", " 2", " 4"] as const),
        previewMode: "commitOnly",
        commit,
      }),
    );

    act(() => {
      result.current.onValueChange([2]);
      result.current.onValueCommit([1]);
    });

    expect(commit).toHaveBeenCalledWith(" 4");
    expect(result.current.sliderValue).toBe(2);
    expect(result.current.displayValue).toBe(" 4");
    expect(result.current.isAwaitingReconciliation).toBe(true);
  });

  it("supports numeric sliders with domain clamping", () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 6,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "commitOnly",
        commit,
      }),
    );

    act(() => {
      result.current.onValueChange([40]);
    });
    expect(result.current.sliderValue).toBe(31);
    expect(result.current.displayValue).toBe(31);
  });

  it("throttles preview writes and coalesces to the latest drag value", () => {
    const preview = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit: vi.fn(),
        previewThrottleMs: 200,
      }),
    );

    act(() => {
      result.current.onValueChange([5]);
    });
    expect(preview).toHaveBeenCalledWith(5);

    act(() => {
      result.current.onValueChange([6]);
      result.current.onValueChange([7]);
    });
    expect(preview).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith(7);
  });

  it("still sends the commit when the drag returns to the pre-drag value after a preview flushed (HARD9-050)", () => {
    // Regression: a throttled preview can already move the device to an
    // intermediate value while drives/info polling is paused (so
    // deviceValue stays frozen at the pre-drag value). If the user then
    // drags back to that exact pre-drag value and releases, the commit-skip
    // equality check compared nextValue against the stale deviceValue and
    // suppressed the corrective write entirely - stranding the device at
    // the last preview's value.
    const preview = vi.fn();
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 50,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit,
        previewThrottleMs: 200,
      }),
    );

    act(() => {
      result.current.onValueChange([80]);
    });
    expect(preview).toHaveBeenCalledWith(80);

    act(() => {
      result.current.onValueChange([50]);
    });

    act(() => {
      result.current.onValueCommit([50]);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(50);
  });

  it("skips the commit when the drag never sent a preview and returns to the pre-drag value", () => {
    // Contrast case: commitOnly mode never flushes a preview, so returning
    // to the exact pre-drag value legitimately needs no corrective write.
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 50,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "commitOnly",
        commit,
      }),
    );

    act(() => {
      result.current.onValueChange([80]);
      result.current.onValueChange([50]);
    });

    act(() => {
      result.current.onValueCommit([50]);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps local response immediate and bounds preview requests during a sustained drag", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit,
        previewThrottleMs: 200,
      }),
    );

    for (let value = 1; value <= 100; value += 1) {
      act(() => {
        result.current.onValueChange([value]);
        vi.advanceTimersByTime(10);
      });
      expect(result.current.sliderValue).toBe(value);
      expect(result.current.displayValue).toBe(value);
    }

    expect(preview.mock.calls.length).toBeLessThanOrEqual(6);

    act(() => {
      result.current.onValueCommit([100]);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(100);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(preview.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("keeps slow preview writes single-flight with one trailing latest intent", async () => {
    const previewRuns: Array<ReturnType<typeof createDeferred>> = [];
    let activePreviewCount = 0;
    let maxActivePreviewCount = 0;
    const preview = vi.fn(() => {
      const run = createDeferred();
      previewRuns.push(run);
      activePreviewCount += 1;
      maxActivePreviewCount = Math.max(maxActivePreviewCount, activePreviewCount);
      return run.promise.finally(() => {
        activePreviewCount -= 1;
      });
    });

    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit: vi.fn(),
        previewThrottleMs: 200,
      }),
    );

    act(() => {
      result.current.onValueChange([10]);
    });
    expect(preview).toHaveBeenCalledTimes(1);

    for (let value = 11; value <= 60; value += 1) {
      act(() => {
        result.current.onValueChange([value]);
        vi.advanceTimersByTime(10);
      });
      expect(result.current.sliderValue).toBe(value);
    }

    expect(preview).toHaveBeenCalledTimes(1);
    expect(activePreviewCount).toBe(1);

    await act(async () => {
      previewRuns[0].resolve();
      await previewRuns[0].promise;
      await Promise.resolve();
    });

    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith(60);
    expect(maxActivePreviewCount).toBe(1);
  });

  it("surfaces synchronous preview exceptions and unlocks subsequent preview writes", () => {
    const onError = vi.fn();
    const preview = vi.fn(() => {
      throw new Error("sync preview failure");
    });
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit: vi.fn(),
        onError,
        previewThrottleMs: 200,
      }),
    );

    act(() => {
      result.current.onValueChange([10]);
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "sync preview failure" }),
      expect.objectContaining({ phase: "preview", value: 10 }),
    );

    act(() => {
      result.current.onValueChange([11]);
      vi.advanceTimersByTime(200);
    });

    expect(preview).toHaveBeenCalledTimes(2);
  });

  it("ignores stale async preview failures after commit bumps generation", async () => {
    const run = createDeferred();
    const onError = vi.fn();
    const preview = vi.fn(() => run.promise);
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit: vi.fn(),
        onError,
        previewThrottleMs: 200,
      }),
    );

    act(() => {
      result.current.onValueChange([10]);
      result.current.onValueCommit([10]);
    });

    await act(async () => {
      run.reject(new Error("late preview failure"));
      await run.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it("schedules a delayed trailing preview when an in-flight preview resolves too quickly", async () => {
    const firstRun = createDeferred();
    const preview = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRun.promise)
      .mockImplementation(async () => undefined);

    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit: vi.fn(),
        previewThrottleMs: 200,
      }),
    );

    act(() => {
      result.current.onValueChange([10]);
      result.current.onValueChange([20]);
    });

    expect(preview).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRun.resolve();
      await firstRun.promise;
      await Promise.resolve();
    });

    expect(preview).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith(20);
  });

  it("logs rapid local intent, coalesced preview, final commit, and stale refresh protection", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ deviceValue }) =>
        useDeviceBoundSlider({
          debugName: "home-case-light-brightness",
          deviceValue,
          domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
          previewMode: "throttled",
          preview,
          commit,
          previewThrottleMs: 200,
        }),
      {
        initialProps: { deviceValue: 0 },
      },
    );

    for (let value = 1; value <= 20; value += 1) {
      act(() => {
        result.current.onValueChange([value]);
        vi.advanceTimersByTime(5);
      });
      expect(result.current.sliderValue).toBe(value);
    }

    expect(preview.mock.calls.length).toBeLessThan(20);

    act(() => {
      result.current.onValueCommit([20]);
    });

    rerender({ deviceValue: 0 });
    expect(result.current.sliderValue).toBe(20);
    expect(result.current.displayValue).toBe(20);

    rerender({ deviceValue: 20 });
    expect(result.current.isAwaitingReconciliation).toBe(false);
    expect(result.current.sliderValue).toBe(20);
    expect(commit).toHaveBeenCalledWith(20);

    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider local intent changed",
      expect.objectContaining({ slider: "home-case-light-brightness", value: 20, priority: "user" }),
    );
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider coalesced write",
      expect.objectContaining({ slider: "home-case-light-brightness", phase: "preview" }),
    );
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider final intent committed",
      expect.objectContaining({ slider: "home-case-light-brightness", value: 20 }),
    );
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider queued write",
      expect.objectContaining({ slider: "home-case-light-brightness", phase: "commit", value: 20 }),
    );
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider stale device value ignored",
      expect.objectContaining({ slider: "home-case-light-brightness", deviceValue: 0, pendingValue: 20 }),
    );
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider latest intent confirmed",
      expect.objectContaining({ slider: "home-case-light-brightness", value: 20 }),
    );
  });

  it("does not send previews in commit-only mode", () => {
    const preview = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "commitOnly",
        preview,
        commit: vi.fn(),
      }),
    );

    act(() => {
      result.current.onValueChange([5]);
      vi.runOnlyPendingTimers();
    });

    expect(preview).not.toHaveBeenCalled();
  });

  it("guarantees a final commit even when a newer preview is still throttled", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 0,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "throttled",
        preview,
        commit,
        previewThrottleMs: 300,
      }),
    );

    act(() => {
      result.current.onValueChange([5]);
      result.current.onValueChange([6]);
      result.current.onValueCommit([6]);
    });

    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(5);
    expect(commit).toHaveBeenCalledWith(6);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("keeps the desired value latched through the reconciliation window, then defers to the device", async () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ deviceValue }) =>
        useDeviceBoundSlider({
          deviceValue,
          domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
          previewMode: "commitOnly",
          commit,
          watchdogMs: 500,
        }),
      {
        initialProps: { deviceValue: 1 },
      },
    );

    await act(async () => {
      result.current.onValueCommit([8]);
    });
    expect(result.current.isAwaitingReconciliation).toBe(true);
    expect(result.current.sliderValue).toBe(8);

    // A stale device echo inside the watchdog window must not snap the
    // slider back; the latched intent is still authoritative here.
    act(() => {
      vi.advanceTimersByTime(499);
    });
    rerender({ deviceValue: 1 });
    expect(result.current.isAwaitingReconciliation).toBe(true);
    expect(result.current.sliderValue).toBe(8);

    // Once the watchdog (re-armed at commit settle) expires without the
    // device ever confirming the write, the device value wins again so the
    // UI cannot keep displaying a value the hardware never accepted.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isAwaitingReconciliation).toBe(false);
    expect(result.current.sliderValue).toBe(1);
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider reconciliation watchdog expired",
      expect.objectContaining({ pendingValue: 8 }),
    );
  });

  it("derives the default reconciliation watchdog from conservative safety timing", async () => {
    mockSafetyConfig.current = {
      ...mockSafetyConfig.current,
      mode: "CONSERVATIVE",
      configsCacheMs: 2000,
      configsCooldownMs: 1200,
      backoffBaseMs: 300,
    };
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 1,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "commitOnly",
        commit,
      }),
    );

    await act(async () => {
      result.current.onValueCommit([8]);
    });

    act(() => {
      vi.advanceTimersByTime(4_499);
    });
    expect(result.current.isAwaitingReconciliation).toBe(true);
    expect(result.current.sliderValue).toBe(8);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isAwaitingReconciliation).toBe(false);
    expect(result.current.sliderValue).toBe(1);
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Device-bound slider reconciliation watchdog expired",
      expect.objectContaining({ pendingValue: 8, watchdogMs: 4_500 }),
    );
  });

  it("treats stale remote echoes as non-authoritative until the current target is confirmed", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ deviceValue }) =>
        useDeviceBoundSlider({
          deviceValue,
          domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
          previewMode: "commitOnly",
          commit,
        }),
      {
        initialProps: { deviceValue: 10 },
      },
    );

    act(() => {
      result.current.onValueCommit([80]);
    });
    expect(result.current.sliderValue).toBe(80);

    rerender({ deviceValue: 10 });
    expect(result.current.sliderValue).toBe(80);
    expect(result.current.displayValue).toBe(80);

    rerender({ deviceValue: 80 });
    expect(result.current.isAwaitingReconciliation).toBe(false);
    expect(result.current.sliderValue).toBe(80);
  });

  it("keeps a newer target latched when an older write result arrives late", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ deviceValue }) =>
        useDeviceBoundSlider({
          deviceValue,
          domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
          previewMode: "commitOnly",
          commit,
        }),
      {
        initialProps: { deviceValue: 10 },
      },
    );

    act(() => {
      result.current.onValueCommit([60]);
    });
    expect(result.current.sliderValue).toBe(60);

    act(() => {
      result.current.onValueCommit([85]);
    });
    expect(result.current.sliderValue).toBe(85);

    rerender({ deviceValue: 60 });
    expect(result.current.sliderValue).toBe(85);
    expect(result.current.isAwaitingReconciliation).toBe(true);

    rerender({ deviceValue: 85 });
    expect(result.current.sliderValue).toBe(85);
    expect(result.current.isAwaitingReconciliation).toBe(false);
  });

  it("clears the desired value when the selected device changes", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ deviceValue }) =>
        useDeviceBoundSlider({
          deviceValue,
          domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
          previewMode: "commitOnly",
          commit,
        }),
      {
        initialProps: { deviceValue: 10 },
      },
    );

    act(() => {
      result.current.onValueCommit([80]);
    });
    expect(result.current.sliderValue).toBe(80);
    expect(result.current.isAwaitingReconciliation).toBe(true);

    act(() => {
      mockSliderContext.selectedDeviceId = "device-b";
    });

    rerender({ deviceValue: 10 });

    expect(result.current.sliderValue).toBe(10);
    expect(result.current.isAwaitingReconciliation).toBe(false);
  });

  it("clears the desired value when the document is hidden", () => {
    const commit = vi.fn();
    const originalVisibilityState = document.visibilityState;
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 10,
        domain: createNumericSliderDomain({ min: 0, max: 100, round: Math.round }),
        previewMode: "commitOnly",
        commit,
      }),
    );

    act(() => {
      result.current.onValueCommit([80]);
    });
    expect(result.current.sliderValue).toBe(80);
    expect(result.current.isAwaitingReconciliation).toBe(true);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.sliderValue).toBe(10);
    expect(result.current.isAwaitingReconciliation).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: originalVisibilityState,
    });
  });

  it("treats type-drifted authoritative values as reconciled when the semantic value matches", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ deviceValue }) =>
        useDeviceBoundSlider({
          deviceValue,
          domain: createIndexedSliderDomain<string | number>(["1", "2", "4"]),
          previewMode: "commitOnly",
          commit,
        }),
      {
        initialProps: { deviceValue: "1" as string | number },
      },
    );

    act(() => {
      result.current.onValueCommit([2]);
    });
    expect(result.current.isAwaitingReconciliation).toBe(true);

    rerender({ deviceValue: 4 });
    expect(result.current.isAwaitingReconciliation).toBe(false);
    expect(result.current.sliderValue).toBe(2);
  });

  it("holds the polling pause through the post-commit tail grace window", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 1,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "commitOnly",
        commit,
      }),
    );

    act(() => {
      result.current.onValueChange([8]);
    });
    expect(pollingPauseRegistry.isPollingPaused()).toBe(true);

    await act(async () => {
      result.current.onValueCommit([8]);
      await Promise.resolve();
    });

    expect(pollingPauseRegistry.isPollingPaused()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(pollingPauseRegistry.isPollingPaused()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(pollingPauseRegistry.isPollingPaused()).toBe(false);
  });
});
