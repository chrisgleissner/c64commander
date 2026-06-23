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
import { renderHook, waitFor } from "@testing-library/react";
import {
  useC64AllConfig,
  useC64Categories,
  useC64Category,
  useC64ConfigItem,
  useC64ConfigItems,
  useC64Drives,
} from "@/hooks/useC64Connection";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";

const connectionSnapshot = {
  state: "REAL_CONNECTED" as "UNKNOWN" | "DISCOVERING" | "REAL_CONNECTED" | "DEMO_ACTIVE" | "OFFLINE_NO_DEMO",
  lastDiscoveryTrigger: null as null | string,
  lastTransitionAtMs: 0,
  lastProbeAtMs: null as number | null,
  lastProbeSucceededAtMs: null as number | null,
  lastProbeFailedAtMs: null as number | null,
  lastProbeError: null as string | null,
  deviceInfo: null as null | Record<string, unknown>,
  demoInterstitialVisible: false,
};

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => connectionSnapshot,
}));

const mockApi = {
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  getConfigItems: vi.fn(),
  getConfigItem: vi.fn(),
  getDrives: vi.fn(),
};

const loadInitialSnapshotMock = vi.fn();

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
  loadInitialSnapshot: (...args: unknown[]) => loadInitialSnapshotMock(...args),
}));

vi.mock("@/lib/secureStorage", () => ({
  hasStoredPasswordFlag: () => false,
  getPassword: async () => "",
}));

vi.mock("@/hooks/useDiagnosticsSuppressionActive", () => ({
  useDiagnosticsSuppressionActive: () => false,
}));

const createWrapper = (screenActive = true) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ScreenActivityProvider, { active: screenActive }, children),
    );
  return { wrapper, client };
};

describe("BUG-061: connection-state gate prevents pre-selection traffic during first-run discovery", () => {
  beforeEach(() => {
    mockApi.getCategories.mockResolvedValue({ categories: ["Audio Mixer"], errors: [] });
    mockApi.getCategory.mockResolvedValue({ "Audio Mixer": { items: {} }, errors: [] });
    mockApi.getConfigItems.mockResolvedValue({ "Audio Mixer": { items: {} }, errors: [] });
    mockApi.getConfigItem.mockResolvedValue({ "Audio Mixer": { items: { Vol: { selected: "0" } } }, errors: [] });
    mockApi.getDrives.mockResolvedValue({ drives: [], errors: [] });
    loadInitialSnapshotMock.mockReset();
    loadInitialSnapshotMock.mockReturnValue(undefined);
    connectionSnapshot.state = "REAL_CONNECTED";
    connectionSnapshot.deviceInfo = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT call getCategories during DISCOVERING (default-target traffic containment)", async () => {
    connectionSnapshot.state = "DISCOVERING";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64Categories(), { wrapper });
    // Wait long enough for any racing query to fire; then assert none did.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi.getCategories).not.toHaveBeenCalled();
  });

  it("does NOT call getDrives during DISCOVERING", async () => {
    connectionSnapshot.state = "DISCOVERING";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64Drives(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi.getDrives).not.toHaveBeenCalled();
  });

  it("does NOT call getConfigItems during DISCOVERING", async () => {
    connectionSnapshot.state = "DISCOVERING";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64ConfigItems("Audio Mixer", ["Vol Tape Read"]), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi.getConfigItems).not.toHaveBeenCalled();
  });

  it("does NOT call getCategory during DISCOVERING", async () => {
    connectionSnapshot.state = "DISCOVERING";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64Category("Audio Mixer"), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi.getCategory).not.toHaveBeenCalled();
  });

  it("does NOT call getConfigItem during DISCOVERING", async () => {
    connectionSnapshot.state = "DISCOVERING";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64ConfigItem("Audio Mixer", "Vol"), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi.getConfigItem).not.toHaveBeenCalled();
  });

  it("does NOT chain into useC64AllConfig when categories are empty during DISCOVERING", async () => {
    connectionSnapshot.state = "DISCOVERING";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64AllConfig(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi.getCategories).not.toHaveBeenCalled();
    expect(mockApi.getCategory).not.toHaveBeenCalled();
  });

  it("does NOT call getCategories during OFFLINE_NO_DEMO", async () => {
    connectionSnapshot.state = "OFFLINE_NO_DEMO";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64Categories(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApi.getCategories).not.toHaveBeenCalled();
  });

  it("DOES call getCategories after transition to REAL_CONNECTED (gate releases correctly)", async () => {
    connectionSnapshot.state = "DISCOVERING";
    const { wrapper } = createWrapper(true);
    const { rerender } = renderHook(() => useC64Categories(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockApi.getCategories).not.toHaveBeenCalled();
    connectionSnapshot.state = "REAL_CONNECTED";
    rerender();
    await waitFor(() => expect(mockApi.getCategories).toHaveBeenCalled());
  });

  it("DOES call getCategories when DEMO_ACTIVE (mock mode also gated only by ready state)", async () => {
    connectionSnapshot.state = "DEMO_ACTIVE";
    const { wrapper } = createWrapper(true);
    renderHook(() => useC64Categories(), { wrapper });
    await waitFor(() => expect(mockApi.getCategories).toHaveBeenCalled());
  });
});