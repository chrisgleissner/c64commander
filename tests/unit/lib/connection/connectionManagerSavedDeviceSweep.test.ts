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
const getSelectedSavedDeviceMock = vi.fn();
const resolveCanonicalProductFamilyCodeMock = vi.fn();
const applyC64APIRuntimeConfigMock = vi.fn();
const startDeviceDiscoveryMock = vi.fn();
const hasPersistedDeviceHostConfigMock = vi.fn();
const setStoredFtpPortMock = vi.fn();
const setStoredTelnetPortMock = vi.fn();

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
  setRuntimeFtpPasswordOverride: vi.fn(),
  clearRuntimeFtpPasswordOverride: vi.fn(),
  setStoredFtpPort: (...args: unknown[]) => setStoredFtpPortMock(...args),
}));

vi.mock("@/lib/telnet/telnetConfig", () => ({
  setStoredTelnetPort: (...args: unknown[]) => setStoredTelnetPortMock(...args),
}));

vi.mock("@/lib/mock/mockServer", () => ({
  startMockServer: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:0", ftpPort: null }),
  stopMockServer: vi.fn().mockResolvedValue(undefined),
  getActiveMockBaseUrl: () => null,
  getActiveMockFtpPort: () => null,
  getActiveMockToken: () => null,
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
  getSelectedSavedDevice: () => getSelectedSavedDeviceMock(),
  resolveCanonicalProductFamilyCode: (...args: unknown[]) => resolveCanonicalProductFamilyCodeMock(...args),
  selectSavedDevice: (...args: unknown[]) => selectSavedDeviceMock(...args),
}));

vi.mock("@/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery: (...args: unknown[]) => startDeviceDiscoveryMock(...args),
}));

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

// Import after mocks are registered.
import {
  discoverConnection,
  getConnectionSnapshot,
  probeDeviceReachability,
  resetManualDiscoveryFallbackCooldownForTests,
} from "@/lib/connection/connectionManager";

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
  // The manual-reconnect escalation rate-limit (HARD18-007) is module-level
  // state that outlives any one discoverConnection() call - reset it so one
  // test's manual tap can't leave the next test's tap inside its cooldown.
  resetManualDiscoveryFallbackCooldownForTests();
  // Default: the OTHER startup-probe path is short-circuited unless a test opts in.
  getInfoMock.mockResolvedValue(UNHEALTHY);
  hasPersistedDeviceHostConfigMock.mockReturnValue(false);
  getSavedDevicesSnapshotMock.mockReturnValue(snapshotWith([]));
  // Default the identity-stamp inputs to the inert values other tests assume;
  // the HARD16-001 test opts into a realistic stateful selection.
  selectSavedDeviceMock.mockReset();
  getSelectedSavedDeviceMock.mockReset();
  getSelectedSavedDeviceMock.mockReturnValue(null);
  resolveCanonicalProductFamilyCodeMock.mockReset();
  resolveCanonicalProductFamilyCodeMock.mockReturnValue(null);
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

  it("selects the reachable candidate but leaves it unverified when verification fails (HARD16-001 switch-path parity)", async () => {
    // Sweep probe -> healthy (reachable), verification probe -> unhealthy (fails).
    getInfoMock.mockResolvedValueOnce(HEALTHY).mockResolvedValueOnce(UNHEALTHY);
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([
        { id: "selected", host: "u64", httpPort: 80, hasPassword: false },
        { id: "flaky", host: "192.168.1.80", httpPort: 80, hasPassword: false, ftpPort: 21, telnetPort: 23 },
      ]),
    );

    await discoverConnection("startup");
    await flushAsync();

    // Selection now moves to the candidate BEFORE verification (mirrors
    // executeSavedDeviceSwitch), so a failed verify leaves it selected but
    // unverified rather than rolled back.
    expect(selectSavedDeviceMock).toHaveBeenCalledWith("flaky");
    expect(completeSavedDeviceVerificationMock).not.toHaveBeenCalled();
    // A failed verification never promotes to REAL_CONNECTED, so the runtime
    // API is not retargeted via transitionToRealConnected.
    expect(applyC64APIRuntimeConfigMock).not.toHaveBeenCalled();
  });

  it("stamps only the reachable device's identity, never the still-selected powered-off device (HARD16-001)", async () => {
    const deviceA = {
      id: "selected",
      host: "u64",
      httpPort: 80,
      hasPassword: false,
      lastKnownUniqueId: "uidA",
      lastKnownProduct: "c64u",
      ftpPort: 21,
      telnetPort: 23,
    };
    const deviceB = {
      id: "other",
      host: "192.168.1.60",
      httpPort: 80,
      hasPassword: false,
      lastKnownUniqueId: "uidB",
      ftpPort: 2121,
      telnetPort: 2323,
    };
    const infoB = { product: "Ultimate-64", unique_id: "uidB", firmware_version: "3.15", hostname: "u64host" };

    // Selection is stateful: A is selected until selectSavedDevice flips it to B,
    // so identity stamping sees exactly the device selected at each moment.
    let selectedId = "selected";
    selectSavedDeviceMock.mockImplementation((id: string) => {
      selectedId = id;
    });
    getSelectedSavedDeviceMock.mockImplementation(() => (selectedId === "selected" ? deviceA : deviceB));
    resolveCanonicalProductFamilyCodeMock.mockReturnValue("u64");

    getSavedDevicesSnapshotMock.mockReturnValue(snapshotWith([deviceA, deviceB]));
    // Sweep probe of B -> healthy; verification probe of B -> healthy.
    getInfoMock.mockResolvedValueOnce(infoB).mockResolvedValueOnce(infoB);

    await discoverConnection("startup");
    await flushAsync();

    // The corruption (fails today): verifying while A is still selected stamps
    // B's identity onto A via setSnapshot -> rememberSelectedSavedDeviceIdentity.
    expect(completeSavedDeviceVerificationMock).not.toHaveBeenCalledWith("selected", expect.anything());
    // B is selected, verified, and its ports applied — the switch path's behaviour.
    expect(selectSavedDeviceMock).toHaveBeenCalledWith("other");
    expect(completeSavedDeviceVerificationMock).toHaveBeenCalledWith("other", infoB);
    expect(setStoredFtpPortMock).toHaveBeenCalledWith(2121);
    expect(setStoredTelnetPortMock).toHaveBeenCalledWith(2323);
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

// HARD18-007: the manual (badge-tap) recovery affordance previously ran
// exactly one probe against the stored (possibly stale, e.g. DHCP
// re-assigned after a firmware-wedge power-cycle) host and gave up straight
// to Offline - it never reached the saved-device sweep or LAN scan that
// startup/resume already use.
describe("manual reconnect escalation (HARD18-007)", () => {
  it("falls back to a reachable saved device when the stored host fails a manual probe", async () => {
    // Primary probe of the stored/selected host -> unreachable, then the
    // sweep probe of the other saved device -> healthy, then its
    // verification probe -> healthy.
    getInfoMock.mockResolvedValueOnce(UNHEALTHY).mockResolvedValueOnce(HEALTHY).mockResolvedValueOnce(HEALTHY);
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([
        { id: "selected", host: "u64", httpPort: 80, hasPassword: false },
        { id: "other", host: "192.168.1.60", httpPort: 80, hasPassword: false },
      ]),
    );

    await discoverConnection("manual");
    await flushAsync();

    expect(selectSavedDeviceMock).toHaveBeenCalledWith("other");
    expect(completeSavedDeviceVerificationMock).toHaveBeenCalledWith("other", HEALTHY);
    // The cheaper, targeted sweep found a reachable device - no need to
    // burst a full LAN scan.
    expect(startDeviceDiscoveryMock).not.toHaveBeenCalled();
  });

  it("falls back to a LAN scan when no other saved device is reachable either", async () => {
    getInfoMock.mockResolvedValue(UNHEALTHY);
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([
        { id: "selected", host: "u64", httpPort: 80, hasPassword: false },
        { id: "other", host: "192.168.1.60", httpPort: 80, hasPassword: false },
      ]),
    );

    await discoverConnection("manual");
    await flushAsync();

    expect(startDeviceDiscoveryMock).toHaveBeenCalled();
  });

  it("does not re-trigger the sweep/scan escalation on a rapid repeated manual tap (rate-limited)", async () => {
    getInfoMock.mockResolvedValue(UNHEALTHY);
    getSavedDevicesSnapshotMock.mockReturnValue(
      snapshotWith([
        { id: "selected", host: "u64", httpPort: 80, hasPassword: false },
        { id: "other", host: "192.168.1.60", httpPort: 80, hasPassword: false },
      ]),
    );

    await discoverConnection("manual");
    await flushAsync();
    expect(startDeviceDiscoveryMock).toHaveBeenCalledTimes(1);

    startDeviceDiscoveryMock.mockClear();
    await discoverConnection("manual");
    await flushAsync();

    expect(startDeviceDiscoveryMock).not.toHaveBeenCalled();
  });
});
