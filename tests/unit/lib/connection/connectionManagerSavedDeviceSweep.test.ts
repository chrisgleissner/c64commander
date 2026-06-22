/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock fns so individual tests can drive per-call behaviour.
// ---------------------------------------------------------------------------
const getInfoMock = vi.fn();
const addLogMock = vi.fn();
const getPasswordForDeviceMock = vi.fn();
const getSavedDevicesSnapshotMock = vi.fn();
const selectSavedDeviceMock = vi.fn();
const completeSavedDeviceVerificationMock = vi.fn();
const applyC64APIRuntimeConfigMock = vi.fn();
const startDeviceDiscoveryMock = vi.fn();
const hasPersistedDeviceHostConfigMock = vi.fn();

vi.mock("@/lib/c64api", () => ({
  C64API: class {
    getInfo = getInfoMock;
  },
  buildBaseUrlFromDeviceHost: (host: string) => `http://${host}`,
  getC64APIConfigSnapshot: () => ({ deviceHost: "u64", baseUrl: "http://u64" }),
  resolveDeviceHostFromStorage: () => "u64",
  getDeviceHostFromBaseUrl: (url: string) => url.replace(/^https?:\/\//, ""),
  applyC64APIConfigFromStorage: vi.fn(),
  applyC64APIRuntimeConfig: (...args: unknown[]) => applyC64APIRuntimeConfigMock(...args),
}));

vi.mock("@/lib/c64api/hostConfig", () => ({
  buildDeviceHostWithHttpPort: (host: string, port?: number) => (port && port !== 80 ? `${host}:${port}` : host),
  hasPersistedDeviceHostConfig: () => hasPersistedDeviceHostConfigMock(),
  stripPortFromDeviceHost: (host: string) => host,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: vi.fn().mockResolvedValue(undefined),
  getPasswordForDevice: (...args: unknown[]) => getPasswordForDeviceMock(...args),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  setRuntimeFtpPortOverride: vi.fn(),
  clearRuntimeFtpPortOverride: vi.fn(),
}));

vi.mock("@/lib/mock/mockServer", () => ({
  startMockServer: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:0", ftpPort: null }),
  stopMockServer: vi.fn().mockResolvedValue(undefined),
  getActiveMockBaseUrl: () => null,
  getActiveMockFtpPort: () => null,
}));

vi.mock("@/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: () => false,
  loadDiscoveryProbeTimeoutMs: () => 2500,
  loadStartupDiscoveryWindowMs: () => 5000,
}));

vi.mock("@/lib/config/featureFlags", () => ({
  featureFlagManager: {
    getSnapshot: () => ({ flags: { demo_mode_enabled: false } }),
    load: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: () => ({ enabled: false, discoveryProbeIntervalMs: 700 }),
}));

vi.mock("@/lib/fuzz/fuzzMode", () => ({
  applyFuzzModeDefaults: vi.fn(),
  getFuzzMockBaseUrl: () => null,
  isFuzzModeEnabled: () => false,
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  getSmokeConfig: () => null,
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
    const raw = error instanceof Error ? error.message : String(error ?? "");
    return { class: "unknown", userMessage: raw || "Unknown transport error", rawMessage: raw, host: ctx.host };
  },
}));

vi.mock("@/lib/uiErrors", () => ({
  clearConnectivityErrorToastsForHost: vi.fn(),
}));

vi.mock("@/lib/connection/reachabilityEvents", () => ({
  registerReachabilityListener: vi.fn(),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  completeSavedDeviceVerification: (...args: unknown[]) => completeSavedDeviceVerificationMock(...args),
  getSavedDevicesSnapshot: () => getSavedDevicesSnapshotMock(),
  getSelectedSavedDevice: () => null,
  resolveCanonicalProductFamilyCode: () => null,
  selectSavedDevice: (...args: unknown[]) => selectSavedDeviceMock(...args),
}));

vi.mock("@/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery: (...args: unknown[]) => startDeviceDiscoveryMock(...args),
}));

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

// Import after mocks are registered.
import { discoverConnection, getConnectionSnapshot, probeDeviceReachability } from "@/lib/connection/connectionManager";

const HEALTHY = { product: "Ultimate-64" };
const UNHEALTHY = {};

const snapshotWith = (devices: Array<Record<string, unknown>>, selectedDeviceId = "selected") => ({
  selectedDeviceId,
  devices,
  summaries: {},
  summaryLru: [],
  hasEverHadMultipleDevices: false,
  runtimeStatuses: {},
  verifiedByDeviceId: {},
  actualDeviceIdByDeviceId: {},
});

const flushAsync = async () => {
  // Allow the immediate, non-awaited startup probe microtasks to settle.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Default: the OTHER startup-probe path is short-circuited unless a test opts in.
  getInfoMock.mockResolvedValue(UNHEALTHY);
  hasPersistedDeviceHostConfigMock.mockReturnValue(false);
  getSavedDevicesSnapshotMock.mockReturnValue(snapshotWith([]));
  startDeviceDiscoveryMock.mockResolvedValue({
    candidates: [],
    scannedHosts: 0,
    elapsedMs: 0,
    unsupported: false,
  });
});

afterEach(() => {
  // Dispose the dangling startup window/probe timers set up by discoverConnection.
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("probeDeviceReachability (lines 262-267)", () => {
  it("returns a healthy probe result for a reachable arbitrary host", async () => {
    getInfoMock.mockResolvedValueOnce(HEALTHY);
    const result = await probeDeviceReachability({ deviceHost: "192.168.1.50:80", password: "secret" });
    expect(result.ok).toBe(true);
    expect(result.deviceInfo).toEqual(HEALTHY);
    expect(getInfoMock).toHaveBeenCalledTimes(1);
  });

  it("honours an explicit timeout override and a null password", async () => {
    getInfoMock.mockResolvedValueOnce(HEALTHY);
    const result = await probeDeviceReachability({ deviceHost: "c64u", password: null, timeoutMs: 500 });
    expect(result.ok).toBe(true);
    expect(getInfoMock).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 500 }));
  });

  it("reports unreachable when the host does not answer /v1/info", async () => {
    getInfoMock.mockRejectedValueOnce(new Error("no route to host"));
    const result = await probeDeviceReachability({ deviceHost: "10.0.0.9:80" });
    expect(result.ok).toBe(false);
    expect(result.deviceInfo).toBeNull();
  });
});

describe("startup saved-device reachability sweep (lines 685-696, 728-730, 1042)", () => {
  it("connects to a reachable saved device without discovery when verification succeeds", async () => {
    // Sweep probe -> healthy, then verifyCurrentConnectionTarget probe -> healthy.
    getInfoMock.mockResolvedValueOnce(HEALTHY).mockResolvedValueOnce(HEALTHY);
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([
        { id: "selected", host: "u64", httpPort: 80, hasPassword: false },
        { id: "other", host: "192.168.1.60", httpPort: 80, hasPassword: false },
      ]),
    );

    await discoverConnection("startup");
    await flushAsync();

    // selectSavedDevice + completeSavedDeviceVerification confirm the success branch ran.
    expect(selectSavedDeviceMock).toHaveBeenCalledWith("other");
    expect(completeSavedDeviceVerificationMock).toHaveBeenCalledWith("other", HEALTHY);
    expect(startDeviceDiscoveryMock).not.toHaveBeenCalled();
  });

  it("reads the saved password and tolerates a secure-storage failure during the sweep (lines 688-696)", async () => {
    getPasswordForDeviceMock.mockRejectedValueOnce(new Error("keystore unavailable"));
    // Sweep probe -> healthy, verification probe -> healthy.
    getInfoMock.mockResolvedValueOnce(HEALTHY).mockResolvedValueOnce(HEALTHY);
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([
        { id: "selected", host: "u64", httpPort: 80, hasPassword: false },
        { id: "secured", host: "192.168.1.70", httpPort: 8080, hasPassword: true },
      ]),
    );

    await discoverConnection("startup");
    await flushAsync();

    expect(getPasswordForDeviceMock).toHaveBeenCalledWith("secured");
    // The swallowed secure-storage failure must surface as a warning, not vanish.
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Failed to read saved-device password during startup sweep; probing without auth",
      expect.objectContaining({ deviceId: "secured", error: "keystore unavailable" }),
    );
    expect(selectSavedDeviceMock).toHaveBeenCalledWith("secured");
  });

  it("does not connect when the reachable device fails verification (lines 728-730, 1042)", async () => {
    // Sweep probe -> healthy (reachable), verification probe -> unhealthy (fails).
    getInfoMock.mockResolvedValueOnce(HEALTHY).mockResolvedValueOnce(UNHEALTHY);
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([
        { id: "selected", host: "u64", httpPort: 80, hasPassword: false },
        { id: "flaky", host: "192.168.1.80", httpPort: 80, hasPassword: false },
      ]),
    );

    await discoverConnection("startup");
    await flushAsync();

    // selectSavedDevice still runs (we committed the runtime config), but the
    // failed verification means completeSavedDeviceVerification is NOT called.
    // verifyCurrentConnectionTarget runs its own "switch" discovery run, which
    // supersedes the startup run, so the fallback returns false and the stale
    // startup run unwinds (line 1042) without entering LAN discovery.
    expect(selectSavedDeviceMock).toHaveBeenCalledWith("flaky");
    expect(completeSavedDeviceVerificationMock).not.toHaveBeenCalled();
  });

  it("skips the sweep and proceeds to LAN discovery when there are no other saved devices", async () => {
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([{ id: "selected", host: "u64", httpPort: 80, hasPassword: false }]),
    );

    await discoverConnection("startup");
    await flushAsync();

    expect(selectSavedDeviceMock).not.toHaveBeenCalled();
    expect(startDeviceDiscoveryMock).toHaveBeenCalled();
    expect(getConnectionSnapshot().lastDiscoveryTrigger).toBe("startup");
  });
});
