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
import { beforeEach, describe, expect, it, vi } from "vitest";

const status = { isConnected: true, isConnecting: false };
const getCategories = vi.fn(async () => ({ categories: ["Audio Mixer"] }));
const getCategory = vi.fn(async () => ({ items: { Volume: { selected: "5" } } }));
const getInFlightReadRequestCount = vi.fn(() => 0);

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status, baseUrl: "http://u64" }),
}));

vi.mock("@/lib/c64api", () => ({
  getDefaultBaseUrl: () => "http://u64",
  getC64API: () => ({
    getCategories,
    getCategory,
    getInFlightReadRequestCount,
    updateConfigBatch: vi.fn(),
  }),
  ConfigResponse: {},
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  createAppConfigEntry: vi.fn(),
  listAppConfigs: vi.fn(() => []),
  loadAppConfigs: vi.fn(() => []),
  loadHasChanges: vi.fn(() => false),
  loadInitialSnapshot: vi.fn(() => null),
  saveAppConfigs: vi.fn(),
  saveInitialSnapshot: vi.fn(),
  updateHasChanges: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/query/c64PollingGovernance", () => ({
  pollingPauseRegistry: {
    isPollingPaused: () => false,
  },
}));

describe("useAppConfigState deferred capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch all config on mount but does when manually triggered", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const { useAppConfigState } = await import("@/hooks/useAppConfigState");

    const { result } = renderHook(() => useAppConfigState(), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    expect(getCategories).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.captureInitialSnapshot();
    });

    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(getCategory).toHaveBeenCalledTimes(1);
    expect(result.current.initialSnapshot).not.toBeNull();
  });
});
