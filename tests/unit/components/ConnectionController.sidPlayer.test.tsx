/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";

const connectionState = { value: "OFFLINE_NO_DEMO" as "OFFLINE_NO_DEMO" | "DEMO_ACTIVE" };
const discoverConnectionMock = vi.fn();

const snapshot = () => ({
  state: connectionState.value,
  lastDiscoveryTrigger: null,
  lastTransitionAtMs: 0,
  lastProbeAtMs: null,
  lastProbeSucceededAtMs: null,
  lastProbeFailedAtMs: null,
  lastProbeError: null,
  demoInterstitialVisible: false,
});

vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => snapshot() }));
vi.mock("@/lib/connection/connectionManager", () => ({
  discoverConnection: (...args: unknown[]) => discoverConnectionMock(...args),
  initializeConnectionManager: async () => undefined,
  getConnectionSnapshot: () => snapshot(),
}));
vi.mock("@/lib/connection/networkTransitions", () => ({ installNetworkTransitions: () => () => undefined }));
vi.mock("@/lib/playback/remoteTuneHandover", () => ({ installRemoteTuneHandover: () => () => undefined }));
vi.mock("@/lib/connection/simulatedDeviceContent", () => ({
  installSimulatedDeviceContentCleanup: () => () => undefined,
}));
vi.mock("@/lib/c64api", () => ({
  buildBaseUrlFromDeviceHost: (host?: string) => `http://${host ?? "c64u"}`,
  resolveDeviceHostFromStorage: () => "c64u",
}));
vi.mock("@/lib/config/appSettings", () => ({
  APP_SETTINGS_KEYS: { BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY: "c64commander:background_rediscovery_interval_ms" },
  loadBackgroundRediscoveryIntervalMs: () => 60_000,
}));
vi.mock("@/lib/secureStorage", () => ({
  getPassword: async () => "",
  hasStoredPasswordFlag: () => false,
}));
vi.mock("@/lib/deviceDiscovery/discoveryManager", () => ({
  getDeviceDiscoveryState: () => ({ phase: "idle", trigger: null, candidates: [], acknowledged: false }),
  subscribeDeviceDiscovery: () => () => undefined,
}));

const renderController = async (startupMode: string | null) => {
  vi.resetModules();
  localStorage.clear();
  if (startupMode) localStorage.setItem("c64u_startup_mode", startupMode);
  const { ConnectionController } = await import("@/components/ConnectionController");
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ConnectionController />
    </QueryClientProvider>,
  );
};

describe("ConnectionController in SID Player", () => {
  beforeEach(() => {
    discoverConnectionMock.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("SPM-NET-02 SID Player arms no background rediscovery timer", async () => {
    vi.useFakeTimers();
    try {
      await renderController("sid-player");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000);
      });
      expect(discoverConnectionMock).not.toHaveBeenCalledWith("background");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("SPM-NET-02 Full App still arms the background rediscovery timer", async () => {
    vi.useFakeTimers();
    try {
      await renderController(null);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(discoverConnectionMock).toHaveBeenCalledWith("background");
    } finally {
      vi.useRealTimers();
    }
  });
});
