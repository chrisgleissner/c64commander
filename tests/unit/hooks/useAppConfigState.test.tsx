/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const status = { isConnected: true, isConnecting: false };

const getCategories = vi.fn(async () => ({ categories: ["Audio Mixer"] }));
const getCategory = vi.fn(async () => ({
  items: { Volume: { selected: "5" } },
}));
const updateConfigBatch = vi.fn(async () => undefined);

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
  useC64Connection: () => ({ status, baseUrl: "http://c64u" }),
}));

vi.mock("@/lib/c64api", () => ({
  getDefaultBaseUrl: () => "http://c64u",
  getC64API: () => ({
    getCategories,
    getCategory,
    updateConfigBatch,
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
}));

describe("useAppConfigState", () => {
  let useAppConfigState: Awaited<ReturnType<typeof import("@/hooks/useAppConfigState")>>["useAppConfigState"];
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: React.ReactNode }) => React.JSX.Element;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    ({ useAppConfigState } = await import("@/hooks/useAppConfigState"));
    queryClient = new QueryClient();
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  it("captures initial snapshot and supports save/load app config", async () => {
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await waitFor(() => {
      expect(getCategories).toHaveBeenCalledTimes(1);
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

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).not.toHaveBeenCalled();
  });

  it("revertToInitial applies snapshot data when initialSnapshot exists", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Audio: { items: { Vol: { value: "7" } } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalledTimes(1);
    expect(updateHasChanges).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("logs when initial snapshot capture fails", async () => {
    const { addLog } = await import("@/lib/logging");
    getCategories.mockRejectedValueOnce(new Error("network error"));
    renderHook(() => useAppConfigState(), { wrapper });

    await waitFor(() => {
      expect(addLog).toHaveBeenCalledWith(
        "debug",
        expect.stringContaining("Initial config snapshot"),
        expect.objectContaining({ error: "network error" }),
      );
    });
  });

  it("handles partial category fetch failure gracefully", async () => {
    const { addLog } = await import("@/lib/logging");
    getCategories.mockResolvedValueOnce({ categories: ["Audio", "Video"] });
    getCategory.mockImplementation(async (cat: string) => {
      if (cat === "Audio") return { items: { Vol: { selected: "5" } } };
      throw new Error("Video unavailable");
    });

    renderHook(() => useAppConfigState(), { wrapper });

    await waitFor(() => {
      expect(addLog).toHaveBeenCalledWith(
        "debug",
        expect.stringContaining("partially failed"),
        expect.objectContaining({ failedCategories: ["Video"] }),
      );
    });
  });

  it("extractValue handles null config via revertToInitial", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { NullItem: null } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { NullItem: null } }));
  });

  it("extractValue handles array config via revertToInitial", async () => {
    loadInitialSnapshot.mockReturnValue({
      savedAt: "t",
      data: { Cat: { items: { ArrItem: [1, 2, 3] } } },
    });
    const { result } = renderHook(() => useAppConfigState(), { wrapper });

    await act(async () => {
      await result.current.revertToInitial();
    });

    expect(updateConfigBatch).toHaveBeenCalledWith(expect.objectContaining({ Cat: { ArrItem: [1, 2, 3] } }));
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

  it("effect returns early and clears hasCaptured when disconnected (line 130)", async () => {
    status.isConnected = false;
    renderHook(() => useAppConfigState(), { wrapper });
    // Allow React to process effects
    await act(async () => {});
    // When disconnected, effect returns early before fetching
    expect(saveInitialSnapshot).not.toHaveBeenCalled();
    status.isConnected = true;
  });

  it("marks hasCaptured from sessionStorage on effect run (line 134)", async () => {
    // Pre-populate sessionStorage so the hook marks hasCaptured=true on first effect
    sessionStorage.setItem("c64u-snapshot-captured-http://c64u", "1");
    renderHook(() => useAppConfigState(), { wrapper });
    await act(async () => {});
    // The hook won't fetch again since hasCaptured=true — snapshot was not saved this run
    expect(saveInitialSnapshot).not.toHaveBeenCalled();
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

  it("fetchAllConfig logs on category failure and partial result (lines 57-64)", async () => {
    getCategories.mockResolvedValue({ categories: ["Audio", "Video"] });
    getCategory
      .mockResolvedValueOnce({ items: { Volume: { selected: "5" } } })
      .mockRejectedValueOnce(new Error("timeout"));
    renderHook(() => useAppConfigState(), { wrapper });

    await waitFor(
      () => {
        expect(getCategory).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
  });
});
