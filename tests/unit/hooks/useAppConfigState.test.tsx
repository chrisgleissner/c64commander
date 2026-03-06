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
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("captures initial snapshot and supports save/load app config", async () => {
    const { useAppConfigState } = await import("@/hooks/useAppConfigState");
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

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
});
