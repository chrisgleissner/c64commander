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
  CONFIG_BROWSER_C64_QUERY_OPTIONS,
  CONFIG_READ_STALE_TIME_MS,
  useC64Categories,
  useC64Category,
  useC64SetConfig,
} from "@/hooks/useC64Connection";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ state: "REAL_CONNECTED", deviceInfo: null, demoInterstitialVisible: false }),
}));

const mockApi = {
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  setConfigValue: vi.fn(),
};

vi.mock("@/lib/c64api", () => ({
  getC64API: () => mockApi,
  updateC64APIConfig: vi.fn(),
  getC64APIConfigSnapshot: () => ({ baseUrl: "http://c64u", password: undefined, deviceHost: "c64u" }),
  buildBaseUrlFromDeviceHost: () => "http://c64u",
  resolveDeviceHostFromStorage: () => "c64u",
  normalizeDeviceHost: () => "c64u",
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  getActiveBaseUrl: () => "http://c64u",
  updateHasChanges: vi.fn(),
  loadInitialSnapshot: vi.fn(),
}));

vi.mock("@/lib/secureStorage", () => ({
  hasStoredPasswordFlag: () => false,
  getPassword: async () => "",
}));

vi.mock("@/hooks/useDiagnosticsSuppressionActive", () => ({
  useDiagnosticsSuppressionActive: () => false,
}));

const CATEGORY = "Audio Mixer";

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const screen = { active: true };
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ScreenActivityProvider, { active: screen.active }, children),
    );
  return { client, screen, wrapper };
};

const useConfigReads = () => {
  useC64Categories(CONFIG_BROWSER_C64_QUERY_OPTIONS);
  return useC64Category(CATEGORY, true, CONFIG_BROWSER_C64_QUERY_OPTIONS);
};

describe("Config reads are reused when the Config tab is activated again", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi.getCategories.mockReset().mockResolvedValue({ categories: [CATEGORY] });
    mockApi.getCategory.mockReset().mockResolvedValue({ [CATEGORY]: { items: {} } });
    mockApi.setConfigValue.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not refetch categories when the tab is shown again after 31 s idle", async () => {
    const { screen, wrapper } = setup();
    const { rerender } = renderHook(useConfigReads, { wrapper });
    await waitFor(() => expect(mockApi.getCategory).toHaveBeenCalledTimes(1));

    screen.active = false;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    screen.active = true;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mockApi.getCategory).toHaveBeenCalledTimes(1);
    expect(mockApi.getCategories).toHaveBeenCalledTimes(1);
  });

  it("serves a remount inside the stale window from cache and refetches after it", async () => {
    const { wrapper } = setup();
    const first = renderHook(useConfigReads, { wrapper });
    await waitFor(() => expect(mockApi.getCategory).toHaveBeenCalledTimes(1));
    first.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const second = renderHook(useConfigReads, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mockApi.getCategory).toHaveBeenCalledTimes(1);
    expect(mockApi.getCategories).toHaveBeenCalledTimes(1);
    second.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIG_READ_STALE_TIME_MS);
    });
    renderHook(useConfigReads, { wrapper });
    await waitFor(() => expect(mockApi.getCategory).toHaveBeenCalledTimes(2));
  });

  it("refetches the category after a config write and after an explicit invalidation", async () => {
    const { client, wrapper } = setup();
    renderHook(useConfigReads, { wrapper });
    const write = renderHook(useC64SetConfig, { wrapper });
    await waitFor(() => expect(mockApi.getCategory).toHaveBeenCalledTimes(1));

    await act(async () => {
      await write.result.current.mutateAsync({ category: CATEGORY, item: "Vol", value: 3 });
    });
    await waitFor(() => expect(mockApi.getCategory).toHaveBeenCalledTimes(2));

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["c64-category", CATEGORY] });
    });
    await waitFor(() => expect(mockApi.getCategory).toHaveBeenCalledTimes(3));
  });
});
