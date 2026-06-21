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
const resolveMdnsHostMock = vi.fn();

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
  getPasswordForDevice: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  setRuntimeFtpPortOverride: vi.fn(),
  clearRuntimeFtpPortOverride: vi.fn(),
  setStoredFtpPort: vi.fn(),
  getStoredFtpPort: () => 1541,
}));

vi.mock("@/lib/telnet/telnetConfig", () => ({
  setStoredTelnetPort: vi.fn(),
  getStoredTelnetPort: () => 23,
}));

vi.mock("@/lib/mock/mockServer", () => ({
  startMockServer: vi.fn(),
  stopMockServer: vi.fn(),
  getActiveMockBaseUrl: () => null,
  getActiveMockFtpPort: () => null,
}));

vi.mock("@/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: () => false,
  loadDiscoveryProbeTimeoutMs: () => 2500,
  loadStartupDiscoveryWindowMs: () => 5000,
  getStoredFtpPort: () => 1541,
  getStoredTelnetPort: () => 23,
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

vi.mock("@/lib/native/mdnsResolver", () => ({
  isBareHostname: (host: string) => /^[a-z][a-z0-9-]*$/i.test(host),
  isMdnsAvailable: () => true,
  resolveMdnsHost: (...args: unknown[]) => resolveMdnsHostMock(...args),
}));

vi.mock("@/lib/c64api/transportErrors", () => ({
  normalizeTransportError: (_error: unknown, ctx: { host?: string }) => ({
    class: "dns",
    userMessage: `Cannot resolve '${ctx.host}'. On Android, prefer the device IP address.`,
    rawMessage: "Cannot resolve host 'u64' via mDNS",
  }),
}));

vi.mock("@/lib/uiErrors", () => ({
  clearConnectivityErrorToastsForHost: vi.fn(),
  clearToastsOnDeviceSwitch: vi.fn(),
}));

vi.mock("@/lib/connection/reachabilityEvents", () => ({
  registerReachabilityListener: vi.fn(),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  completeSavedDeviceVerification: vi.fn(),
  failSavedDeviceVerification: vi.fn(),
  buildSavedDeviceDiagnosticsAttribution: () => ({}),
  getSavedDeviceById: () => null,
  getSavedDeviceSwitchSummary: () => ({ lastResolvedAddress: null }),
  getSavedDevicesSnapshot: () => ({
    selectedDeviceId: null,
    devices: [],
    summaries: {},
    verifiedByDeviceId: {},
  }),
  resolveCanonicalProductFamilyCode: () => null,
  selectSavedDevice: vi.fn(),
  startSavedDeviceVerification: vi.fn(),
}));

vi.mock("@/lib/savedDevices/savedDeviceSwitchMetrics", () => ({
  beginSavedDeviceSwitchAttempt: () => "attempt-id",
  completeSavedDeviceSwitchAttempt: vi.fn(),
  markSavedDeviceSwitchSelectionApplied: vi.fn(),
  markSavedDeviceSwitchVerificationStarted: vi.fn(),
  getSavedDeviceSwitchPrefixes: () => [],
}));

vi.mock("@/lib/query/c64QueryInvalidation", () => ({
  getSavedDeviceSwitchPrefixes: () => [],
  invalidateForSavedDeviceSwitch: vi.fn(),
}));

vi.mock("@/lib/tracing/traceContext", () => ({
  setTraceDeviceAttributionContext: vi.fn(),
}));

vi.mock("@/lib/diagnostics/healthCheckState", () => ({
  setHealthCheckStateSnapshot: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

import { verifyCurrentConnectionTarget } from "@/lib/connection/connectionManager";

describe("BUG-052 - Android bare-hostname mDNS failures short-circuit the Save & Connect probe", () => {
  beforeEach(() => {
    getInfoMock.mockReset();
    addLogMock.mockReset();
    resolveMdnsHostMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("first call returns the typed mDNS failure with the user-facing 'prefer IP' guidance", async () => {
    resolveMdnsHostMock.mockRejectedValueOnce(
      Object.assign(new Error("Cannot resolve host 'u64' via mDNS"), {
        message: "Cannot resolve host 'u64' via mDNS",
      }),
    );

    const result = await verifyCurrentConnectionTarget({ deviceHost: "u64", password: null });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Cannot resolve 'u64'. On Android, prefer the device IP address.");
    // The fetch /v1/info probe must NOT have been invoked — we short-circuit
    // the slow system-DNS attempt when Android mDNS already failed.
    expect(getInfoMock).not.toHaveBeenCalled();
  });

  it("second call uses the negative cache so mDNS is not re-invoked and the probe is skipped", async () => {
    resolveMdnsHostMock.mockRejectedValue(
      Object.assign(new Error("Cannot resolve host 'u64' via mDNS"), {
        message: "Cannot resolve host 'u64' via mDNS",
      }),
    );

    const first = await verifyCurrentConnectionTarget({ deviceHost: "u64", password: null });
    const firstMdnsCalls = resolveMdnsHostMock.mock.calls.length;
    const second = await verifyCurrentConnectionTarget({ deviceHost: "u64", password: null });
    const secondMdnsCalls = resolveMdnsHostMock.mock.calls.length;

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(second.error).toBe(first.error);
    // The negative cache must short-circuit the second invocation — no new
    // mDNS plugin call and no slow direct fetch against the unresolved host.
    expect(secondMdnsCalls - firstMdnsCalls).toBe(0);
    expect(getInfoMock).not.toHaveBeenCalled();
  });
});
