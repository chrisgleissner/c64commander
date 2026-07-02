/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = { isConnected: true, isConnecting: false };

const getCategories = vi.fn(async () => ({ categories: ["Audio Mixer"] }));
const getCategory = vi.fn(async () => ({
  items: { Volume: { selected: "5" } },
}));
const getCachedCategory = vi.fn(() => null);
const updateConfigBatch = vi.fn(async () => undefined);
const getInFlightReadRequestCount = vi.fn(() => 0);

const loadInitialSnapshot = vi.fn(() => null);
const loadHasChanges = vi.fn(() => false);
const listAppConfigs = vi.fn(() => []);
const saveInitialSnapshot = vi.fn();
const updateHasChanges = vi.fn();
const loadAppConfigs = vi.fn(() => []);
const saveAppConfigs = vi.fn();
const createAppConfigEntry = vi.fn((_baseUrl, name, data) => ({
  id: `id-${name}`,
  name,
  data,
  savedAt: "now",
}));

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
  useC64Connection: () => ({ status, baseUrl: "http://c64u" }),
}));

vi.mock("@/lib/c64api", () => ({
  getDefaultBaseUrl: () => "http://c64u",
  getC64API: () => ({
    getCategories,
    getCachedCategory,
    getCategory,
    updateConfigBatch,
    getInFlightReadRequestCount,
  }),
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  loadInitialSnapshot,
  loadHasChanges,
  listAppConfigs,
  saveInitialSnapshot,
  updateHasChanges,
  loadAppConfigs,
  saveAppConfigs,
  createAppConfigEntry,
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

describe("useAppConfigState", () => {
  let useAppConfigState: Awaited<ReturnType<typeof import("@/hooks/useAppConfigState")>>["useAppConfigState"];
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: React.ReactNode }) => React.JSX.Element;

  beforeEach(async () => {
    vi.clearAllMocks();
    status.isConnected = true;
    status.isConnecting = false;
    getCategories.mockReset();
    getCategories.mockResolvedValue({ categories: ["Audio Mixer"] });
    getCategory.mockReset();
    getCategory.mockResolvedValue({
      items: { Volume: { selected: "5" } },
    });
    getCachedCategory.mockReset();
    getCachedCategory.mockReturnValue(null);
    getInFlightReadRequestCount.mockReset();
    getInFlightReadRequestCount.mockReturnValue(0);
    updateConfigBatch.mockReset();
    updateConfigBatch.mockResolvedValue(undefined);
    loadInitialSnapshot.mockReset();
    loadInitialSnapshot.mockReturnValue(null);
    loadHasChanges.mockReset();
    loadHasChanges.mockReturnValue(false);
    listAppConfigs.mockReset();
    listAppConfigs.mockReturnValue([]);
    loadAppConfigs.mockReset();
    loadAppConfigs.mockReturnValue([]);
    createAppConfigEntry.mockReset();
    createAppConfigEntry.mockImplementation((_baseUrl, name, data) => ({
      id: `id-${name}`,
      name,
      data,
      savedAt: "now",
    }));
    sessionStorage.clear();
    ({ useAppConfigState } = await import("@/hooks/useAppConfigState"));
    queryClient = new QueryClient();
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("supports manual initial snapshot capture and save/load app config", async () => {
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    expect(getCategories).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    await act(async () => {
      await result.current.saveCurrentConfig("Profile A");
    });

    expect(saveAppConfigs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.loadAppConfig({
        id: "id-Profile A",
        name: "Profile A",
        savedAt: "now",
        data: { "Audio Mixer": { items: { Volume: { selected: "5" } } } },
      });
    });

    expect(updateConfigBatch).toHaveBeenCalledTimes(1);
    expect(updateHasChanges).toHaveBeenCalled();
  });

  it("renames matching config entry and leaves others unchanged", async () => {
    loadAppConfigs.mockReturnValue([
      { id: "id-A", name: "Profile A", data: {}, savedAt: "t1" },
      { id: "id-B", name: "Profile B", data: {}, savedAt: "t2" },
    ]);
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    act(() => {
      result.current.renameAppConfig("id-A", "Renamed");
    });

    const saved = saveAppConfigs.mock.calls[0][0] as { id: string; name: string }[];
    expect(saved.find((e) => e.id === "id-A")?.name).toBe("Renamed");
    expect(saved.find((e) => e.id === "id-B")?.name).toBe("Profile B");
  });

  it("deletes the matching config entry and keeps others", async () => {
    loadAppConfigs.mockReturnValue([
      { id: "id-A", name: "Profile A", data: {}, savedAt: "t1" },
      { id: "id-B", name: "Profile B", data: {}, savedAt: "t2" },
    ]);
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    act(() => {
      result.current.deleteAppConfig("id-A");
    });

    const saved = saveAppConfigs.mock.calls[0][0] as { id: string }[];
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("id-B");
  });

  it("revertToInitial does nothing when initialSnapshot is null", async () => {
    loadInitialSnapshot.mockReturnValue(null);
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    let revertResult;
    await act(async () => {
      revertResult = await result.current.revertToInitial();
    });

    expect(revertResult).toEqual({ status: "missing-snapshot" });
    expect(updateConfigBatch).not.toHaveBeenCalled();
  });

  it("revertToInitial applies snapshot data and verifies the restored values", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Audio: { items: { Vol: { value: "7" } } } },
    });
    getCategories.mockResolvedValue({ categories: ["Audio"] });
    getCategory.mockResolvedValue({ items: { Vol: { selected: "7" } } });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    let revertResult;
    await act(async () => {
      revertResult = await result.current.revertToInitial();
    });

    expect(revertResult).toEqual({ status: "reverted" });
    expect(updateConfigBatch).toHaveBeenCalledTimes(1);
    expect(updateHasChanges).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("revertToInitial invalidates c64-config-items/c64-config-item so Home reflects it (HARD9-017)", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Audio: { items: { Vol: { value: "7" } } } },
    });
    getCategories.mockResolvedValue({ categories: ["Audio"] });
    getCategory.mockResolvedValue({ items: { Vol: { selected: "7" } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64-config-items"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64-config-item"] });
  });

  it("revertToInitial reports verification mismatches after applying the snapshot", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Audio: { items: { Vol: { value: "7" } } } },
    });
    getCategories.mockResolvedValue({ categories: ["Audio"] });
    getCategory.mockResolvedValue({ items: { Vol: { selected: "5" } } });

    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    let revertResult;
    await act(async () => {
      revertResult = await result.current.revertToInitial();
    });

    expect(revertResult).toMatchObject({
      status: "verification-failed",
      mismatchCount: 1,
      message: expect.stringContaining("1 setting"),
      mismatches: [
        expect.objectContaining({
          category: "Audio",
          item: "Vol",
          expected: "7",
          actual: "5",
        }),
      ],
    });
    expect(updateHasChanges).not.toHaveBeenCalledWith(expect.any(String), false);
  });

  it("sets fetchError state when manual initial snapshot capture fails", async () => {
    getCategories.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    expect(result.current.fetchError).toBe("network error");

    getCategories.mockReset();
    getCategories.mockResolvedValue({ categories: ["Audio Mixer"] });
  });

  it("does not start idle initial snapshot capture while the app is hidden", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(getCategories).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("schedules idle initial snapshot capture after the app becomes visible again", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getCategories).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCategories).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("defers idle initial snapshot capture while foreground reads are still active", async () => {
    vi.useFakeTimers();
    getInFlightReadRequestCount.mockReturnValueOnce(2).mockReturnValue(0);
    renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(getCategories).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCategories).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("uses background intent for idle initial snapshot capture", async () => {
    vi.useFakeTimers();
    renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(getCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        __c64uIntent: "background",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(getCategory).toHaveBeenCalledWith(
      "Audio Mixer",
      expect.objectContaining({
        __c64uIntent: "background",
        signal: expect.any(AbortSignal),
      }),
    );
    vi.useRealTimers();
  });

  it("cancels an in-flight idle snapshot when the app becomes hidden", async () => {
    vi.useFakeTimers();
    let idleSignal: AbortSignal | undefined;
    getCategories.mockImplementation(
      async (options?: { signal?: AbortSignal }) =>
        new Promise<{ categories: string[] }>(() => {
          idleSignal = options?.signal;
        }),
    );
    renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(idleSignal?.aborted).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(idleSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("logs a hidden-state cancellation when idle capture finishes after the app leaves the foreground", async () => {
    const { addLog } = await import("@/lib/logging");
    vi.useFakeTimers();
    let resolveCategories: ((value: { categories: string[] }) => void) | null = null;
    getCategories.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCategories = resolve;
        }),
    );

    renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    await act(async () => {
      resolveCategories?.({ categories: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Idle config snapshot capture cancelled",
      expect.objectContaining({ baseUrl: "http://c64u", reason: "hidden" }),
    );
    expect(saveInitialSnapshot).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("logs idle initial snapshot capture failures at error level", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    vi.useFakeTimers();
    getCategories.mockRejectedValueOnce(new Error("device timeout"));

    renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addErrorLog).toHaveBeenCalledWith(
      "Idle config snapshot capture failed",
      expect.objectContaining({ baseUrl: "http://c64u", error: "device timeout" }),
    );
    vi.useRealTimers();
  });

  it("recovers a failed initial snapshot after a retry", async () => {
    getCategories.mockRejectedValueOnce(new Error("temporary config outage")).mockResolvedValue({
      categories: ["Audio Mixer"],
    });

    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });
    expect(result.current.fetchError).toBe("temporary config outage");
    expect(saveInitialSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    expect(saveInitialSnapshot).toHaveBeenCalledWith(
      "http://c64u",
      expect.objectContaining({
        data: expect.objectContaining({
          "Audio Mixer": expect.any(Object),
        }),
      }),
    );
    expect(result.current.fetchError).toBeNull();
  });

  it("logs at error level when manual initial snapshot capture fails", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    getCategories.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    expect(addErrorLog).toHaveBeenCalledWith(
      expect.stringContaining("Initial config snapshot"),
      expect.objectContaining({ error: "network error" }),
    );

    getCategories.mockReset();
    getCategories.mockResolvedValue({ categories: ["Audio Mixer"] });
  });

  it("handles partial category fetch failure gracefully", async () => {
    const { addLog } = await import("@/lib/logging");
    getCategories.mockResolvedValueOnce({ categories: ["Audio", "Video"] });
    getCategory.mockImplementation(async (cat: string) => {
      if (cat === "Audio") return { items: { Vol: { selected: "5" } } };
      throw new Error("Video unavailable");
    });

    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    expect(addLog).toHaveBeenCalledWith(
      "debug",
      expect.stringContaining("partially failed"),
      expect.objectContaining({ failedCategories: ["Video"] }),
    );
  });

  it("extractValue normalizes null config to empty string via revertToInitial", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { NullItem: null } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    // null is not a valid config scalar; extractConfigValue normalizes it to ""
    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { NullItem: "" } }));
  });

  it("extractValue normalizes array config to empty string via revertToInitial", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { ArrItem: [1, 2, 3] } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    // arrays are not valid config scalars; extractConfigValue normalizes them to ""
    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { ArrItem: "" } }));
  });

  it("extractValue handles primitive string config via revertToInitial", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { StrItem: "raw" } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { StrItem: "raw" } }));
  });

  it("extractValue uses value field when selected is absent", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { VolItem: { value: "8" } } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { VolItem: "8" } }));
  });

  it("extractValue uses current field when selected and value absent", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { Item: { current: "3" } } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { Item: "3" } }));
  });

  it("extractValue falls back to empty string when no known field", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { Item: { unknown: "x" } } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { Item: "" } }));
  });

  it("applyConfigData skips read-only SID Detected Socket items", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: {
        Audio: {
          items: {
            Volume: { selected: "5" },
            "SID Detected Socket 1": { selected: "yes" },
          },
        },
      },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    const batchPayload = updateConfigBatch.mock.calls[0][0] as Record<string, Record<string, string | number>>;
    expect(Object.keys(batchPayload.Audio)).not.toContain("SID Detected Socket 1");
    expect(Object.keys(batchPayload.Audio)).toContain("Volume");
  });

  it("applyConfigData skips categories with no writable items", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: {
        Audio: {
          items: { "SID Detected Socket 1": { selected: "yes" } },
        },
      },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    const batchPayload = updateConfigBatch.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(batchPayload)).not.toContain("Audio");
  });

  it("does not capture the initial snapshot on mount", async () => {
    renderHook(() => useAppConfigState(), { wrapper });
    await act(async () => {});
    expect(saveInitialSnapshot).not.toHaveBeenCalled();
  });

  it("does not recapture the initial snapshot when one is already stored", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Audio: { items: { Volume: { selected: "5" } } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });
    await act(async () => {});
    expect(getCategories).not.toHaveBeenCalled();
    expect(saveInitialSnapshot).not.toHaveBeenCalled();
    expect(result.current.initialSnapshot).not.toBeNull();
  });

  it("extractItems uses categoryBlock when items field absent (line 49 fallback)", async () => {
    // data.Audio has no .items property — categoryBlock itself is iterated
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: {
        Audio: { Volume: { selected: "5" } },
      },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalled();
  });

  it("extractItems returns empty for string category value (lines 51, 173)", async () => {
    // string category → itemsBlock is a string → typeof !== 'object' → return []
    // Then in applyConfigData: items.length === 0 → continue (line 173)
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: {
        BadCat: "not-an-object" as unknown as Record<string, unknown>,
      },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    const batchPayload = updateConfigBatch.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(batchPayload)).not.toContain("BadCat");
  });

  it("fetchAllConfig retries failed categories and logs partial result (lines 57-64)", async () => {
    const { addLog } = await import("@/lib/logging");
    getCategories.mockResolvedValue({ categories: ["Audio", "Video"] });
    getCategory
      .mockResolvedValueOnce({ items: { Volume: { selected: "5" } } })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    expect(getCategory).toHaveBeenCalledTimes(3);
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      expect.stringContaining("partially failed"),
      expect.objectContaining({ failedCategories: ["Video"] }),
    );
  });

  it("reuses cached category snapshots during initial capture before issuing another category request", async () => {
    getCategories.mockResolvedValue({ categories: ["LED Strip Settings", "Audio Mixer"] });
    getCachedCategory.mockImplementation((category: string) =>
      category === "LED Strip Settings"
        ? ({
            "LED Strip Settings": {
              items: {
                "LedStrip Mode": { selected: "Fixed Color" },
                "Fixed Color": { selected: "Royal Blue" },
              },
            },
            errors: [],
          } as const)
        : null,
    );
    getCategory.mockImplementation(async (category: string) => ({
      items: {
        Name: { selected: category },
      },
    }));

    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    expect(saveInitialSnapshot).toHaveBeenCalledWith(
      "http://c64u",
      expect.objectContaining({
        data: expect.objectContaining({
          "LED Strip Settings": expect.objectContaining({
            "LED Strip Settings": expect.objectContaining({
              items: expect.objectContaining({
                "LedStrip Mode": expect.any(Object),
              }),
            }),
          }),
          "Audio Mixer": expect.any(Object),
        }),
      }),
    );
    expect(getCachedCategory).toHaveBeenCalledWith("LED Strip Settings");
    expect(getCachedCategory).toHaveBeenCalledWith("Audio Mixer");
    expect(getCategory).toHaveBeenCalledTimes(1);
    expect(getCategory).toHaveBeenCalledWith(
      "Audio Mixer",
      expect.objectContaining({
        __c64uIntent: "user",
      }),
    );
  });
});
