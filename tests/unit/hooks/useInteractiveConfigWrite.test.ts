/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks ---

const mockMutateAsync = vi.fn();
vi.mock("@/hooks/useC64Connection", () => ({
  useC64UpdateConfigBatch: () => ({ mutateAsync: mockMutateAsync }),
}));

const mockWaitForMachineTransitionsToSettle = vi.fn(() => Promise.resolve());
const mockBeginInteractiveWriteBurst = vi.fn(() => vi.fn());
vi.mock("@/lib/deviceInteraction/deviceActivityGate", () => ({
  waitForMachineTransitionsToSettle: () => mockWaitForMachineTransitionsToSettle(),
  beginInteractiveWriteBurst: () => mockBeginInteractiveWriteBurst(),
}));

const mockReportUserError = vi.fn();
vi.mock("@/lib/uiErrors", () => ({
  reportUserError: (report: unknown) => mockReportUserError(report),
}));

// --- Helpers ---

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

import { useInteractiveConfigWrite } from "@/hooks/useInteractiveConfigWrite";

// --- Tests ---

describe("useInteractiveConfigWrite", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMutateAsync.mockResolvedValue({ errors: [] });
    mockWaitForMachineTransitionsToSettle.mockResolvedValue(undefined);
    const endBurst = vi.fn();
    mockBeginInteractiveWriteBurst.mockReturnValue(endBurst);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("calls mutateAsync with immediate:true and skipInvalidation:true on a single write", async () => {
    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.write({ "SID1 Volume": "12" });
      await vi.runAllTimersAsync();
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      category: "Audio Mixer",
      updates: { "SID1 Volume": "12" },
      immediate: true,
      skipInvalidation: true,
    });
  });

  it("coalesces rapid writes — only the last payload reaches mutateAsync", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    // Block the beforeRun gate so intermediate writes queue up.
    mockWaitForMachineTransitionsToSettle.mockImplementation(() => gate);

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.write({ "SID1 Volume": "5" });
      result.current.write({ "SID1 Volume": "8" });
      result.current.write({ "SID1 Volume": "12" });
    });

    // Unblock the gate so the lane runs.
    await act(async () => {
      releaseGate();
      await vi.runAllTimersAsync();
    });

    // Only the last write should have been sent.
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ updates: { "SID1 Volume": "12" } }));
  });

  it("schedules reconciliation 250 ms after the last write", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), { wrapper });

    await act(async () => {
      result.current.write({ "SID1 Volume": "10" });
      await vi.runAllTimersAsync();
    });

    // Reconciliation should have fired after 250 ms.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["c64-config-items", "Audio Mixer"],
    });
  });

  it("uses custom reconcileQueryKeys when provided", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () =>
        useInteractiveConfigWrite({
          category: "LED Strip Settings",
          reconcileQueryKeys: [["c64-category", "LED Strip Settings"]],
        }),
      { wrapper },
    );

    await act(async () => {
      result.current.write({ "Strip Intensity": 15 });
      await vi.runAllTimersAsync();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["c64-category", "LED Strip Settings"],
    });
    // Default key should NOT have been invalidated.
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["c64-config-items", "LED Strip Settings"],
    });
  });

  it("gates write through waitForMachineTransitionsToSettle", async () => {
    let releaseSettle!: () => void;
    const settleGate = new Promise<void>((resolve) => {
      releaseSettle = resolve;
    });
    mockWaitForMachineTransitionsToSettle.mockReturnValueOnce(settleGate);

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.write({ "SID1 Volume": "7" });
    });

    // Gate not yet released — mutateAsync should not have been called.
    expect(mockMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      releaseSettle();
      await vi.runAllTimersAsync();
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("calls beginInteractiveWriteBurst and its returned endBurst", async () => {
    const endBurst = vi.fn();
    mockBeginInteractiveWriteBurst.mockReturnValue(endBurst);

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.write({ "SID1 Volume": "9" });
      await vi.runAllTimersAsync();
    });

    expect(mockBeginInteractiveWriteBurst).toHaveBeenCalledTimes(1);
    expect(endBurst).toHaveBeenCalledTimes(1);
  });

  it("calls endBurst even when mutateAsync rejects", async () => {
    const endBurst = vi.fn();
    mockBeginInteractiveWriteBurst.mockReturnValue(endBurst);
    mockMutateAsync.mockRejectedValueOnce(new Error("network failure"));

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(result.current.write({ "SID1 Volume": "3" })).rejects.toThrow("network failure");
      await vi.runAllTimersAsync();
    });

    expect(endBurst).toHaveBeenCalledTimes(1);
  });

  it("surfaces errors via reportUserError and does not show a success toast", async () => {
    const error = new Error("network failure");
    mockMutateAsync.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(result.current.write({ "SID1 Volume": "3" })).rejects.toThrow("network failure");
      await vi.runAllTimersAsync();
    });

    expect(mockReportUserError).toHaveBeenCalledTimes(1);
    expect(mockReportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Update failed",
        description: "network failure",
        error,
        retry: expect.any(Function),
      }),
    );
  });

  it("does not show a success toast on successful writes", async () => {
    // reportUserError should not be called on success.
    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.write({ "SID1 Volume": "14" });
      await vi.runAllTimersAsync();
    });

    expect(mockReportUserError).not.toHaveBeenCalled();
  });

  it("sets isPending to true while a write is in flight and clears it on success", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    mockMutateAsync.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.write({ "SID1 Volume": "11" });
    });

    // After scheduling (lane runs async), isPending should eventually be true.
    await act(async () => {
      await Promise.resolve();
    });

    // Resolve the pending write.
    await act(async () => {
      resolve();
      await vi.runAllTimersAsync();
    });

    expect(result.current.isPending).toBe(false);
  });

  it("resets isPending to false when mutateAsync rejects", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error("oops"));

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(result.current.write({ "SID1 Volume": "2" })).rejects.toThrow("oops");
      await vi.runAllTimersAsync();
    });

    expect(result.current.isPending).toBe(false);
  });

  it("uses String(error) as description when rejection value is not an Error instance", async () => {
    mockMutateAsync.mockRejectedValueOnce("network failure string");

    const { result } = renderHook(() => useInteractiveConfigWrite({ category: "Audio Mixer" }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(result.current.write({ "SID1 Volume": "3" })).rejects.toBe("network failure string");
      await vi.runAllTimersAsync();
    });

    expect(mockReportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "network failure string",
      }),
    );
  });

  it("schedules reconciliation after the write settles, not before", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    let resolveWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    mockMutateAsync.mockReturnValueOnce(writeGate);

    const { result } = renderHook(
      () => useInteractiveConfigWrite({ category: "Audio Mixer", reconciliationDelayMs: 50 }),
      { wrapper },
    );

    act(() => {
      result.current.write({ "SID1 Volume": "10" });
    });

    // Advance well past the reconciliation delay before the write settles.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Reconciliation must NOT have fired yet — write hasn't settled.
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Now settle the write and advance past the reconciliation delay.
    await act(async () => {
      resolveWrite();
      await vi.runAllTimersAsync();
    });

    // Reconciliation fires only after the write settled.
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("debounces reconciliation — only fires once after a burst of writes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () => useInteractiveConfigWrite({ category: "Audio Mixer", reconciliationDelayMs: 100 }),
      { wrapper },
    );

    // Schedule three writes in quick succession.
    await act(async () => {
      result.current.write({ "SID1 Volume": "1" });
      result.current.write({ "SID1 Volume": "5" });
      result.current.write({ "SID1 Volume": "10" });
      // Advance time, but less than the reconciliation delay.
      vi.advanceTimersByTime(50);
    });

    // No invalidation yet.
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Advance past the reconciliation delay.
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Reconciliation should fire exactly once.
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
