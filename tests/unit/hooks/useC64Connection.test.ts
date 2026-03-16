/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useC64AllConfig,
  useC64Categories,
  useC64ConfigItem,
  useC64ConfigItems,
  useC64Category,
  useC64Connection,
  useC64Drives,
  useC64MachineControl,
  useC64SetConfig,
  useC64UpdateConfigBatch,
} from "@/hooks/useC64Connection";

const connectionSnapshot = {
  state: "REAL_CONNECTED" as const,
  lastDiscoveryTrigger: null as const,
  lastTransitionAtMs: 0,
  lastProbeAtMs: null as number | null,
  lastProbeSucceededAtMs: null as number | null,
  lastProbeFailedAtMs: null as number | null,
  lastProbeError: null as string | null,
  demoInterstitialVisible: false,
};

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => connectionSnapshot,
}));

const mockApi = {
  getInfo: vi.fn(),
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  getConfigItems: vi.fn(),
  getConfigItem: vi.fn(),
  updateConfigBatch: vi.fn(),
  getDrives: vi.fn(),
  setConfigValue: vi.fn(),
  machineReset: vi.fn(),
  machineReboot: vi.fn(),
  machinePause: vi.fn(),
  machineResume: vi.fn(),
  machinePowerOff: vi.fn(),
  machineMenuButton: vi.fn(),
  saveConfig: vi.fn(),
  loadConfig: vi.fn(),
  resetConfig: vi.fn(),
};

const updateC64APIConfigMock = vi.fn();
const updateHasChangesMock = vi.fn();
const loadInitialSnapshotMock = vi.fn();
const hasStoredPasswordFlagMock = vi.fn(() => false);
const loadStoredPasswordMock = vi.fn(async () => "");

vi.mock("@/lib/c64api", () => ({
  getC64API: () => mockApi,
  updateC64APIConfig: (...args: unknown[]) => updateC64APIConfigMock(...args),
  C64_DEFAULTS: { DEFAULT_DEVICE_HOST: "c64u" },
  getDefaultBaseUrl: () => "http://default",
  buildBaseUrlFromDeviceHost: (host?: string) => `http://${host ?? "c64u"}`,
  getDeviceHostFromBaseUrl: (baseUrl?: string) => baseUrl?.replace(/^https?:\/\//, "") ?? "c64u",
  normalizeDeviceHost: (host?: string) => host?.trim() || "c64u",
  resolveDeviceHostFromStorage: () => "c64u",
  getC64APIConfigSnapshot: () => ({
    baseUrl: "http://default",
    password: undefined,
    deviceHost: "c64u",
  }),
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  getActiveBaseUrl: () => "http://default",
  updateHasChanges: (...args: unknown[]) => updateHasChangesMock(...args),
  loadInitialSnapshot: (...args: unknown[]) => loadInitialSnapshotMock(...args),
}));

vi.mock("@/lib/secureStorage", () => ({
  hasStoredPasswordFlag: () => hasStoredPasswordFlagMock(),
  getPassword: () => loadStoredPasswordMock(),
}));

const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);

  return { wrapper, client };
};

describe("useC64Connection", () => {
  beforeEach(() => {
    mockApi.getInfo.mockResolvedValue({ errors: [] });
    mockApi.getCategories.mockResolvedValue({
      categories: ["Audio"],
      errors: [],
    });
    mockApi.getCategory.mockResolvedValue({ Audio: { items: {} }, errors: [] });
    mockApi.getConfigItem.mockResolvedValue({
      Audio: { items: { Volume: { selected: "0 dB" } } },
      errors: [],
    });
    mockApi.getConfigItems.mockResolvedValue({
      Audio: { items: {} },
      errors: [],
    });
    mockApi.updateConfigBatch.mockResolvedValue({ errors: [] });
    mockApi.getDrives.mockResolvedValue({
      drives: [{ a: { enabled: true } }],
      errors: [],
    });
    mockApi.setConfigValue.mockResolvedValue({ errors: [] });
    mockApi.machineReset.mockResolvedValue({ errors: [] });
    mockApi.machineReboot.mockResolvedValue({ errors: [] });
    mockApi.machinePause.mockResolvedValue({ errors: [] });
    mockApi.machineResume.mockResolvedValue({ errors: [] });
    mockApi.machinePowerOff.mockResolvedValue({ errors: [] });
    mockApi.machineMenuButton.mockResolvedValue({ errors: [] });
    mockApi.saveConfig.mockResolvedValue({ errors: [] });
    mockApi.loadConfig.mockResolvedValue({ errors: [] });
    mockApi.resetConfig.mockResolvedValue({ errors: [] });
    updateC64APIConfigMock.mockReset();
    updateHasChangesMock.mockReset();
    loadInitialSnapshotMock.mockReset();
    loadInitialSnapshotMock.mockReturnValue(undefined);
    hasStoredPasswordFlagMock.mockReset();
    hasStoredPasswordFlagMock.mockReturnValue(false);
    loadStoredPasswordMock.mockReset();
    loadStoredPasswordMock.mockResolvedValue("");
    localStorage.clear();
  });

  afterEach(() => {
    mockApi.getInfo.mockReset();
    mockApi.getCategories.mockReset();
    mockApi.getCategory.mockReset();
    mockApi.getConfigItem.mockReset();
    mockApi.getConfigItems.mockReset();
    mockApi.updateConfigBatch.mockReset();
    mockApi.getDrives.mockReset();
    mockApi.setConfigValue.mockReset();
    mockApi.machineReset.mockReset();
    mockApi.machineReboot.mockReset();
    mockApi.machinePause.mockReset();
    mockApi.machineResume.mockReset();
    mockApi.machinePowerOff.mockReset();
    mockApi.machineMenuButton.mockReset();
    mockApi.saveConfig.mockReset();
    mockApi.loadConfig.mockReset();
    mockApi.resetConfig.mockReset();
  });

  it("reports connection status and updates config", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      result.current.updateConfig("host.local", "pw");
    });
    expect(updateC64APIConfigMock).toHaveBeenCalledWith("http://host.local", "pw", "host.local");
    await waitFor(() => expect(result.current.baseUrl).toBe("http://host.local"));
    expect(result.current.password).toBe("pw");
    expect(result.current.deviceHost).toBe("host.local");
  });

  it("responds to connection change events", async () => {
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-connection-change", {
          detail: {
            baseUrl: "http://event",
            password: "evt",
            deviceHost: "host",
          },
        }),
      );
    });

    await waitFor(() => expect(result.current.baseUrl).toBe("http://event"));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64-info"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64-drives"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["c64-categories"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64-category"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["c64-config-item"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["c64-config-items"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["c64-all-config"],
    });
    expect(invalidateSpy.mock.calls.some(([arg]) => "predicate" in arg)).toBe(false);
  });

  it("ignores connection change events without effective settings delta", async () => {
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-connection-change", {
          detail: { baseUrl: "http://c64u", password: "", deviceHost: "c64u" },
        }),
      );
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("fetches categories", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Categories(), { wrapper });

    await waitFor(() => expect(result.current.data?.categories).toEqual(["Audio"]));
  });

  it("marks config changes on mutation success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64SetConfig(), { wrapper });

    result.current.mutate({ category: "Audio", item: "Volume", value: "0 dB" });
    await waitFor(() => expect(updateHasChangesMock).toHaveBeenCalled());
  });

  it("fetches all config and tolerates failures", async () => {
    const { wrapper } = createWrapper();
    mockApi.getCategories.mockResolvedValue({
      categories: ["Audio", "Video"],
      errors: [],
    });
    mockApi.getCategory.mockImplementation(async (category: string) => {
      if (category === "Video") {
        throw new Error("fail");
      }
      return { [category]: { items: {} }, errors: [] };
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });

    const { result } = renderHook(() => useC64AllConfig(), { wrapper });
    await waitFor(() => expect(result.current.data?.Audio).toBeDefined());
    expect(result.current.data?.Video).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("updates config batch and marks changes", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64UpdateConfigBatch(), { wrapper });

    result.current.mutate({ category: "Audio", updates: { Volume: "0 dB" } });
    await waitFor(() => expect(updateHasChangesMock).toHaveBeenCalled());
  });

  it("fetches a config item when enabled", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64ConfigItem("Audio", "Volume"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApi.getConfigItem).toHaveBeenCalledWith("Audio", "Volume", { __c64uIntent: "background" });
  });

  it("fetches drives", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Drives(), { wrapper });

    await waitFor(() => expect(result.current.data?.drives).toBeDefined());
  });

  it("supports visible-priority config item queries for page entry", async () => {
    const { wrapper } = createWrapper();

    renderHook(
      () =>
        useC64ConfigItems("Audio", ["Volume"], true, {
          intent: "user",
          refetchOnMount: "always",
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(mockApi.getConfigItems).toHaveBeenCalledWith("Audio", ["Volume"], { __c64uIntent: "user" }),
    );
  });

  it("supports visible-priority category and drive queries for page entry", async () => {
    const { wrapper } = createWrapper();

    renderHook(() => useC64Category("Audio", true, { intent: "user", refetchOnMount: "always" }), { wrapper });
    renderHook(() => useC64Drives({ intent: "user", refetchOnMount: "always" }), { wrapper });

    await waitFor(() => {
      expect(mockApi.getCategory).toHaveBeenCalledWith("Audio", { __c64uIntent: "user" });
      expect(mockApi.getDrives).toHaveBeenCalledWith({ __c64uIntent: "user" });
    });
  });

  it("invalidates and flags config loads and resets", async () => {
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useC64MachineControl(), { wrapper });

    await act(async () => {
      await result.current.loadConfig.mutateAsync();
    });
    await act(async () => {
      await result.current.resetConfig.mutateAsync();
    });

    expect(updateHasChangesMock).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64-category"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["c64-all-config"],
    });
  });

  it("invalidates queries after reboot delay", async () => {
    vi.useFakeTimers();
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useC64MachineControl(), { wrapper });

    await act(async () => {
      await result.current.reboot.mutateAsync();
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["c64"] });
    vi.useRealTimers();
  });

  it("calls /v1/info in demo mode and reports isConnected as true", async () => {
    connectionSnapshot.state = "DEMO_ACTIVE" as const;
    mockApi.getInfo.mockClear();

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isDemo).toBe(true));
    // isConnected must be true in demo mode
    expect(result.current.status.isConnected).toBe(true);
    // deviceType must be 'demo'
    expect(result.current.status.deviceType).toBe("demo");
    // /v1/info must still be called in demo mode
    await waitFor(() => expect(mockApi.getInfo).toHaveBeenCalled());

    // Restore for other tests
    connectionSnapshot.state = "REAL_CONNECTED" as const;
  });

  it("reports disconnected status in DISCOVERING state", async () => {
    connectionSnapshot.state = "DISCOVERING" as const;
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    expect(result.current.status.isConnected).toBe(false);
    expect(result.current.status.isConnecting).toBe(true);
    expect(result.current.status.connectionState).toBe("disconnected");
    expect(result.current.status.deviceType).toBeNull();

    connectionSnapshot.state = "REAL_CONNECTED" as const;
  });

  it("reports disconnected status in OFFLINE_NO_DEMO state", async () => {
    connectionSnapshot.state = "OFFLINE_NO_DEMO" as const;
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    expect(result.current.status.isConnected).toBe(false);
    expect(result.current.status.isConnecting).toBe(false);
    expect(result.current.status.connectionState).toBe("disconnected");
    expect(result.current.status.deviceType).toBeNull();
    expect(result.current.status.isDemo).toBe(false);

    connectionSnapshot.state = "REAL_CONNECTED" as const;
  });

  it("reports disconnected status in UNKNOWN state", async () => {
    connectionSnapshot.state = "UNKNOWN" as const;
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    expect(result.current.status.isConnected).toBe(false);
    expect(result.current.status.connectionState).toBe("disconnected");
    expect(result.current.status.deviceType).toBeNull();

    connectionSnapshot.state = "REAL_CONNECTED" as const;
  });

  it("updateConfig is a no-op when values have not changed", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      // Same host and password
      result.current.updateConfig("c64u", "");
    });

    // Should not have called updateC64APIConfig since nothing changed
    expect(updateC64APIConfigMock).not.toHaveBeenCalled();
  });

  it("ignores connection change events with null detail", async () => {
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent("c64u-connection-change", { detail: null }));
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("handles connection change events with partial detail (only baseUrl)", async () => {
    const { wrapper, client } = createWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-connection-change", {
          detail: { baseUrl: "http://new-host" },
        }),
      );
    });

    await waitFor(() => expect(result.current.baseUrl).toBe("http://new-host"));
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("reports error as null when no query error exists", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));
    expect(result.current.status.error).toBeNull();
  });

  it("returns null deviceInfo before data loads", async () => {
    connectionSnapshot.state = "OFFLINE_NO_DEMO" as const;
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    // Query is disabled in OFFLINE_NO_DEMO so deviceInfo remains null
    expect(result.current.status.deviceInfo).toBeNull();

    connectionSnapshot.state = "REAL_CONNECTED" as const;
  });

  it("returns runtimeBaseUrl from config snapshot", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.status.isConnected).toBe(true));
    expect(result.current.runtimeBaseUrl).toBe("http://default");
  });

  it("loads stored password when secure storage indicates one exists", async () => {
    hasStoredPasswordFlagMock.mockReturnValue(true);
    loadStoredPasswordMock.mockResolvedValue("stored-secret");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.password).toBe("stored-secret"));
  });

  it("provides config-items placeholder data from snapshot and then queries API", async () => {
    loadInitialSnapshotMock.mockReturnValue({
      data: {
        Audio: {
          items: {
            Volume: { selected: "0 dB" },
            Balance: { selected: "Center" },
          },
        },
      },
    });
    mockApi.getConfigItems = vi.fn().mockResolvedValue({
      Audio: {
        items: {
          Volume: { selected: "6 dB" },
        },
      },
      errors: [],
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64ConfigItems("Audio", ["Volume"]), { wrapper });

    expect(result.current.data).toEqual({
      Audio: {
        items: {
          Volume: { selected: "0 dB" },
        },
      },
      errors: [],
    });

    await waitFor(() =>
      expect(mockApi.getConfigItems).toHaveBeenCalledWith("Audio", ["Volume"], { __c64uIntent: "background" }),
    );
  });

  it("supports nested snapshot category blocks for config-items placeholder data", async () => {
    loadInitialSnapshotMock.mockReturnValue({
      data: {
        Audio: {
          Audio: {
            items: {
              Volume: { selected: "Nested" },
            },
          },
        },
      },
    });
    mockApi.getConfigItems = vi.fn().mockResolvedValue({ Audio: { items: {} }, errors: [] });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64ConfigItems("Audio", ["Volume"]), { wrapper });

    expect(result.current.data).toEqual({
      Audio: {
        items: {
          Volume: { selected: "Nested" },
        },
      },
      errors: [],
    });
  });

  it("does not query config-items when disabled or no items are requested", async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useC64ConfigItems("Audio", ["Volume"], false), {
      wrapper,
    });
    renderHook(() => useC64ConfigItems("Audio", [], true), { wrapper });

    await waitFor(() => {
      expect(mockApi.getConfigItems).not.toHaveBeenCalled();
    });
  });

  it("does not query useC64Category when category is empty or disabled", async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useC64Category("", true), { wrapper });
    renderHook(() => useC64Category("Audio", false), { wrapper });

    await waitFor(() => {
      expect(mockApi.getCategory).not.toHaveBeenCalled();
    });
  });

  it("throws when all categories fail in useC64AllConfig", async () => {
    mockApi.getCategories.mockResolvedValue({
      categories: ["Audio", "Video"],
      errors: [],
    });
    mockApi.getCategory.mockRejectedValue(new Error("all failed"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64AllConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect((result.current.error as Error).message).toContain(
        "Failed to fetch configuration data for all categories",
      );
    });
  });

  it("rateLimitedInfoRefetch returns early when called back-to-back (line 90 rate-limit)", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });
    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    // First call sets the last-run timestamp
    act(() => result.current.updateConfig("host1.local", "pw1"));
    // Second call immediately after — within the min interval — should be suppressed
    act(() => result.current.updateConfig("host2.local", "pw2"));

    // Both calls changed settings, but the second rateLimitedInfoRefetch was suppressed
    expect(updateC64APIConfigMock).toHaveBeenCalledTimes(2);
  });

  it("setPassword receives empty string when loadStoredPassword returns null (line 102 || fallback)", async () => {
    hasStoredPasswordFlagMock.mockReturnValue(true);
    loadStoredPasswordMock.mockResolvedValue(null as unknown as string);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });

    await waitFor(() => expect(result.current.password).toBe(""));
  });

  it("connection change event uses current.baseUrl when detail.baseUrl is not a string (line 117 FALSE)", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64Connection(), { wrapper });
    await waitFor(() => expect(result.current.status.isConnected).toBe(true));

    const initialBaseUrl = result.current.baseUrl;

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-connection-change", {
          detail: { password: "new-secret", baseUrl: 42 },
        }),
      );
    });

    await waitFor(() => expect(result.current.password).toBe("new-secret"));
    // baseUrl should NOT have changed since detail.baseUrl is not a string
    expect(result.current.baseUrl).toBe(initialBaseUrl);
  });

  it("config-items placeholder returns undefined when requested items are absent from snapshot (line 232 TRUE)", async () => {
    loadInitialSnapshotMock.mockReturnValue({
      data: {
        Audio: {
          items: {
            Bass: { selected: "0" },
          },
        },
      },
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64ConfigItems("Audio", ["Volume"]), { wrapper });

    // No matching item → placeholderData should be undefined
    expect(result.current.data).toBeUndefined();
  });

  it("config-items falls back to categoryPayload when nested category key is missing (line 224 fallback)", async () => {
    loadInitialSnapshotMock.mockReturnValue({
      data: {
        Audio: {
          items: {
            Volume: { selected: "Flat" },
          },
        },
      },
    });
    mockApi.getConfigItems = vi.fn().mockResolvedValue({ Audio: { items: {} }, errors: [] });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useC64ConfigItems("Audio", ["Volume"]), { wrapper });

    // categoryPayload["Audio"] is undefined → fallback to categoryPayload itself
    // (categoryPayload has .items) → Volume is found in items
    expect(result.current.data).toEqual({
      Audio: { items: { Volume: { selected: "Flat" } } },
      errors: [],
    });
  });
});
