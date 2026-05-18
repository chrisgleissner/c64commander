/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionSnapshot = {
  state: "REAL_CONNECTED" as const,
  lastDiscoveryTrigger: null as const,
  lastTransitionAtMs: 0,
  lastProbeAtMs: null as number | null,
  lastProbeSucceededAtMs: null as number | null,
  lastProbeFailedAtMs: null as number | null,
  lastProbeError: null as string | null,
  deviceInfo: null,
  demoInterstitialVisible: false,
};

const mockApi = {
  getConfigItems: vi.fn(),
};

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => connectionSnapshot,
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => mockApi,
  updateC64APIConfig: vi.fn(),
  C64_DEFAULTS: { DEFAULT_DEVICE_HOST: "u64" },
  getDefaultBaseUrl: () => "http://u64",
  buildBaseUrlFromDeviceHost: (host?: string) => `http://${host ?? "u64"}`,
  getDeviceHostFromBaseUrl: (baseUrl?: string) => baseUrl?.replace(/^https?:\/\//, "") ?? "u64",
  normalizeDeviceHost: (host?: string) => host?.trim() || "u64",
  resolveDeviceHostFromStorage: () => "u64",
  getC64APIConfigSnapshot: () => ({ baseUrl: "http://u64", password: undefined, deviceHost: "u64" }),
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  getActiveBaseUrl: () => "http://u64",
  updateHasChanges: vi.fn(),
  loadInitialSnapshot: vi.fn(() => null),
}));

vi.mock("@/lib/secureStorage", () => ({
  hasStoredPasswordFlag: () => false,
  getPassword: vi.fn(async () => ""),
}));

describe("useC64ConfigItems enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getConfigItems.mockResolvedValue({
      "U64 Specific Settings": {
        items: {
          "System Mode": "PAL",
        },
      },
      errors: [],
    });
  });

  it("passes skipEnrichment through to the API for Home summary queries", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const { useC64ConfigItems } = await import("@/hooks/useC64Connection");

    renderHook(
      () =>
        useC64ConfigItems("U64 Specific Settings", ["System Mode"], true, {
          intent: "user",
          refetchOnMount: "always",
          skipEnrichment: true,
        }),
      {
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
      },
    );

    await waitFor(() =>
      expect(mockApi.getConfigItems).toHaveBeenCalledWith("U64 Specific Settings", ["System Mode"], {
        __c64uIntent: "user",
        __c64uSkipItemEnrichment: true,
      }),
    );
  });
});
