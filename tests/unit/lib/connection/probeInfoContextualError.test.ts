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

vi.mock("@/lib/c64api/transportErrors", () => ({
  normalizeTransportError: (error: unknown, ctx: { host?: string }) => {
    normalizeTransportErrorSpy(error, ctx);
    const raw = error instanceof Error ? error.message : String(error ?? "");
    if (/(unknown host|enotfound|getaddrinfo|cannot resolve|unable to resolve)/i.test(raw)) {
      return {
        class: "dns",
        userMessage: `Couldn't resolve '${ctx.host}'. Check the device's hostname, or use its IP address.`,
        rawMessage: raw,
      };
    }
    if (/^HTTP\s+\d+/.test(raw)) {
      return { class: "unknown", userMessage: raw, rawMessage: raw };
    }
    return { class: "unknown", userMessage: raw || "Unknown transport error", rawMessage: raw };
  },
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

// Import after mocks are registered
import { probeInfoOnce } from "@/lib/connection/connectionManager";

describe("probeInfoOnce contextualizes DNS-class transport errors before returning", () => {
  beforeEach(() => {
    getInfoMock.mockReset();
    addLogMock.mockReset();
    normalizeTransportErrorSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the user-friendly DNS message when a hostname probe fails to resolve", async () => {
    // A device host that the OS resolver can't resolve fails the direct fetch
    // with a raw DNS error; probeInfoOnce must surface the contextual guidance
    // rather than the raw fetch text.
    getInfoMock.mockRejectedValueOnce(
      new TypeError('Unable to resolve host "u64": No address associated with hostname'),
    );

    const result = await probeInfoOnce();

    expect(result.ok).toBe(false);
    expect(result.deviceInfo).toBeNull();
    // The returned error must be the user-friendly DNS guidance, not the raw
    // fetch error text.
    expect(result.error).toBe("Couldn't resolve 'u64'. Check the device's hostname, or use its IP address.");
    expect(result.error).not.toContain("Unable to resolve host");
    // The mapper must be invoked with the original error and the active host.
    expect(normalizeTransportErrorSpy).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({ host: "u64" }),
    );
  });

  it("preserves HTTP-class error messages unchanged (no false DNS normalization)", async () => {
    getInfoMock.mockRejectedValueOnce(new Error("HTTP 503 Service Unavailable"));

    const result = await probeInfoOnce();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 503 Service Unavailable");
  });

  it("preserves the raw error verbatim when the mapper returns the same text (e.g. unknown transport)", async () => {
    getInfoMock.mockRejectedValueOnce(new Error("Some bespoke transport failure"));

    const result = await probeInfoOnce();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Some bespoke transport failure");
  });
});
