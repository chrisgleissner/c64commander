import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIndexedSliderDomain,
  createNumericSliderDomain,
  useDeviceBoundSlider,
} from "@/hooks/useDeviceBoundSlider";

describe("useDeviceBoundSlider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
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

  it("recovers from stalled reconciliation when the watchdog expires", () => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useDeviceBoundSlider({
        deviceValue: 1,
        domain: createNumericSliderDomain({ min: 0, max: 31, round: Math.round }),
        previewMode: "commitOnly",
        commit,
        watchdogMs: 500,
      }),
    );

    act(() => {
      result.current.onValueCommit([8]);
    });
    expect(result.current.isAwaitingReconciliation).toBe(true);
    expect(result.current.sliderValue).toBe(8);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.isAwaitingReconciliation).toBe(false);
    expect(result.current.sliderValue).toBe(1);
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
});
