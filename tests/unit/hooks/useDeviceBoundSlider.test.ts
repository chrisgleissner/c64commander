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

vi.mock("@/hooks/useSavedDevices", () => ({
  useSavedDevices: () => ({
    selectedDeviceId: mockSliderContext.selectedDeviceId,
  }),
}));

describe("useDeviceBoundSlider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSliderContext.selectedDeviceId = "device-a";
    pollingPauseRegistry.__resetForTest();
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

  it("keeps the desired value latched after the pause watchdog expires until the device catches up", () => {
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

    act(() => {
      result.current.onValueCommit([8]);
    });
    expect(result.current.isAwaitingReconciliation).toBe(true);
    expect(result.current.sliderValue).toBe(8);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    rerender({ deviceValue: 1 });
    expect(result.current.isAwaitingReconciliation).toBe(true);
    expect(result.current.sliderValue).toBe(8);
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
