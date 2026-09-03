/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getInfoMock = vi.fn();
const addLogMock = vi.fn();
const normalizeTransportErrorSpy = vi.fn();

vi.mock("@/lib/c64api", () => ({
  C64API: class {
    getInfo = getInfoMock;
  },
  buildBaseUrlFromDeviceHost: (host: string) => `http://${host}`,
  getC64APIConfigSnapshot: () => ({ deviceHost: "u64" }),
  resolveDeviceHostFromStorage: () => "u64",
  stripPortFromDeviceHost: (host: string) => host,
  getDeviceHostHttpPort: () => 80,
  buildDeviceHostWithHttpPort: (host: string) => host,
  applyC64APIConfigFromStorage: vi.fn(),
  applyC64APIRuntimeConfig: vi.fn(),
  getDeviceHostFromBaseUrl: (url: string) => url.replace(/^https?:\/\//, ""),
}));

vi.mock("@/lib/c64api/hostConfig", () => ({
  buildDeviceHostWithHttpPort: (host: string) => host,
  getDeviceHostHttpPort: () => 80,
  stripPortFromDeviceHost: (host: string) => host,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  setRuntimeFtpPortOverride: vi.fn(),
  clearRuntimeFtpPortOverride: vi.fn(),
  setRuntimeFtpPasswordOverride: vi.fn(),
  clearRuntimeFtpPasswordOverride: vi.fn(),
}));

vi.mock("@/lib/mock/mockServer", () => ({
  startMockServer: vi.fn(),
  stopMockServer: vi.fn(),
  getActiveMockBaseUrl: () => null,
  getActiveMockFtpPort: () => null,
  getActiveMockToken: () => null,
  isSimulatedDeviceAvailable: () => true,
}));

vi.mock("@/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: () => false,
  loadDiscoveryProbeTimeoutMs: () => 2500,
  loadStartupDiscoveryWindowMs: () => 5000,
}));

vi.mock("@/lib/config/featureFlags", () => ({
  featureFlagManager: { getSnapshot: () => ({ flags: { demo_mode_enabled: false } }) },
}));

vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: () => ({ enabled: false }),
}));

vi.mock("@/lib/fuzz/fuzzMode", () => ({
  applyFuzzModeDefaults: vi.fn(),
  getFuzzMockBaseUrl: () => null,
  isFuzzModeEnabled: () => false,
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  getSmokeConfig: () => ({}),
  initializeSmokeMode: vi.fn(),
  isSmokeModeEnabled: () => false,
  recordSmokeStatus: vi.fn(),
}));

vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  resetInteractionState: vi.fn(),
}));

vi.mock("@/lib/deviceInteraction/deviceStateStore", () => ({
  updateDeviceConnectionState: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  clearConnectivityErrorToastsForHost: vi.fn(),
}));

vi.mock("@/lib/connection/reachabilityEvents", () => ({
  registerReachabilityListener: vi.fn(),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  completeSavedDeviceVerification: vi.fn(),
  getSavedDevicesSnapshot: () => ({ summaries: {}, verifiedByDeviceId: {} }),
  getSelectedSavedDevice: () => null,
  resolveCanonicalProductFamilyCode: () => null,
}));

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

// The real transportErrors module is deliberately NOT mocked here. Its
// getHttpStatusFromError chokepoint is the behaviour under test: it recognises
// 401/403 from an annotated error whose message does not start with "HTTP".

import { probeDeviceReachability, probeInfoOnce, probeOnce } from "@/lib/connection/connectionManager";

const annotatedAuthError = () => Object.assign(new Error("getInfo failed: HTTP 401"), { c64uHttpStatus: 401 });

describe("every probe entry point classifies an auth failure through the same chokepoint", () => {
  beforeEach(() => {
    getInfoMock.mockReset();
    addLogMock.mockReset();
    normalizeTransportErrorSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports authRequired from probeInfoOnce when the 401 message is not anchored at 'HTTP'", async () => {
    getInfoMock.mockRejectedValueOnce(annotatedAuthError());

    const result = await probeInfoOnce();

    expect(result.ok).toBe(false);
    expect(result.authRequired).toBe(true);
  });

  it("reports authRequired from probeDeviceReachability for the same error", async () => {
    getInfoMock.mockRejectedValueOnce(annotatedAuthError());

    const result = await probeDeviceReachability({ deviceHost: "u64" });

    expect(result.ok).toBe(false);
    expect(result.authRequired).toBe(true);
  });

  it("logs the same transport failure at the same level from probeOnce and probeInfoOnce", async () => {
    getInfoMock.mockRejectedValueOnce(new Error("Some bespoke transport failure"));
    await probeOnce();
    const fromProbeOnce = addLogMock.mock.calls.filter((call) => call[0] !== "debug");

    addLogMock.mockReset();
    getInfoMock.mockRejectedValueOnce(new Error("Some bespoke transport failure"));
    await probeInfoOnce();
    const fromProbeInfoOnce = addLogMock.mock.calls.filter((call) => call[0] !== "debug");

    expect(fromProbeOnce.length).toBe(1);
    expect(fromProbeInfoOnce).toEqual(fromProbeOnce);
  });
});
