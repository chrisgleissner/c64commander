/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as logging from "../../../src/lib/logging";
import { getFuzzMockBaseUrl, isFuzzModeEnabled } from "../../../src/lib/fuzz/fuzzMode";
import {
  loadAutomaticDemoModeEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadStartupDiscoveryWindowMs,
} from "../../../src/lib/config/appSettings";
import { featureFlagManager } from "../../../src/lib/config/featureFlags";
import { getSmokeConfig, isSmokeModeEnabled, recordSmokeStatus } from "../../../src/lib/smoke/smokeMode";
import { getPassword as loadStoredPassword } from "../../../src/lib/secureStorage";

import { CURRENT_DEVICE_HOST_KEY as DEVICE_HOST_KEY } from "../../../src/lib/c64api/hostConfig";

vi.mock("../../../src/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: vi.fn(() => false),
  loadDebugLoggingEnabled: vi.fn(() => false),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 600),
}));

vi.mock("../../../src/lib/config/featureFlags", () => ({
  featureFlagManager: {
    load: vi.fn(async () => undefined),
    getSnapshot: vi.fn(() => ({ flags: { demo_mode_enabled: false } })),
  },
}));

vi.mock("../../../src/lib/fuzz/fuzzMode", () => ({
  applyFuzzModeDefaults: vi.fn(),
  isFuzzModeEnabled: vi.fn(() => false),
  getFuzzMockBaseUrl: vi.fn(() => null),
}));

vi.mock("../../../src/lib/smoke/smokeMode", () => ({
  initializeSmokeMode: vi.fn(async () => null),
  getSmokeConfig: vi.fn(() => null),
  isSmokeModeEnabled: vi.fn(() => false),
  isSmokeReadOnlyEnabled: vi.fn(() => true),
  recordSmokeStatus: vi.fn(async () => undefined),
}));

vi.mock("../../../src/lib/c64api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/c64api")>("../../../src/lib/c64api");
  return {
    ...actual,
    applyC64APIRuntimeConfig: vi.fn(),
  };
});

vi.mock("../../../src/lib/secureStorage", () => ({
  getPassword: vi.fn(async () => null),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

vi.mock("../../../src/lib/uiErrors", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/uiErrors")>("../../../src/lib/uiErrors");
  return {
    ...actual,
    clearConnectivityErrorToastsForHost: vi.fn(),
  };
});

const notifyAuthRequired = vi.fn();
vi.mock("../../../src/lib/auth/authChallenge", () => ({
  notifyAuthRequired,
  notifyAuthSatisfied: vi.fn(),
  getAuthChallengeSnapshot: vi.fn(() => null),
  resetAuthChallengeForTests: vi.fn(),
  useAuthChallenge: vi.fn(() => null),
  subscribeAuthChallenge: vi.fn(() => () => undefined),
}));

const startMockServer = vi.fn(async () => {
  throw new Error("Mock C64U server is only available on native platforms.");
});
const stopMockServer = vi.fn(async () => undefined);
const getActiveMockBaseUrl = vi.fn(() => null);
const getActiveMockFtpPort = vi.fn(() => null);
const getActiveMockToken = vi.fn(() => null);
const startDeviceDiscovery = vi.fn(async () => ({
  candidates: [],
  scannedHosts: 0,
  elapsedMs: 0,
  unsupported: false,
}));
const persistDiscoveredDevice = vi.fn();

vi.mock("../../../src/lib/mock/mockServer", () => ({
  startMockServer,
  stopMockServer,
  getActiveMockBaseUrl,
  getActiveMockFtpPort,
  getActiveMockToken,
}));

vi.mock("../../../src/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery,
  persistDiscoveredDevice,
}));

const ensureStorage = () => {
  const createMemoryStorage = () => {
    let store = new Map<string, string>();
    return {
      getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store = new Map();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };
  };

  const attachStorage = (key: "localStorage" | "sessionStorage") => {
    if (key in globalThis && globalThis[key as keyof typeof globalThis]) return;
    Object.defineProperty(globalThis, key, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  };

  attachStorage("localStorage");
  attachStorage("sessionStorage");
};

describe("connectionManager", () => {
  beforeEach(() => {
    ensureStorage();
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: ["offline"] }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.mocked(isFuzzModeEnabled).mockReturnValue(false);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue(null);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);
    vi.mocked(loadDiscoveryProbeTimeoutMs).mockReturnValue(2500);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(600);
    vi.mocked(isSmokeModeEnabled).mockReturnValue(false);
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: false } } as never);
    vi.mocked(recordSmokeStatus).mockResolvedValue(undefined);
    vi.mocked(getSmokeConfig as any).mockReturnValue(null);
    startMockServer.mockImplementation(async () => {
      throw new Error("Mock C64U server is only available on native platforms.");
    });
    startMockServer.mockClear();
    stopMockServer.mockClear();
    getActiveMockBaseUrl.mockClear();
    getActiveMockFtpPort.mockClear();
    startDeviceDiscovery.mockClear();
    startDeviceDiscovery.mockResolvedValue({
      candidates: [],
      scannedHosts: 0,
      elapsedMs: 0,
      unsupported: false,
    });
    persistDiscoveredDevice.mockClear();
    notifyAuthRequired.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows demo interstitial at most once per session (manual/startup), never for background", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    // Force an unreachable URL so probes always fail quickly.
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    await initializeConnectionManager();
    expect(getConnectionSnapshot().state).toBe("UNKNOWN");

    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(9000);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(true);

    // Dismiss, then manual discovery should not show again in same session.
    const { dismissDemoInterstitial } = await import("../../../src/lib/connection/connectionManager");
    dismissDemoInterstitial();
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);

    void discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);

    // Background rediscovery must never show interstitial.
    void discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("forces demo mode in fuzz mode and applies forced mock base URL", async () => {
    const { isFuzzModeEnabled, getFuzzMockBaseUrl } = await import("../../../src/lib/fuzz/fuzzMode");
    vi.mocked(isFuzzModeEnabled).mockReturnValue(true);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue("http://127.0.0.1:9999");

    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } = await import("../../../src/lib/c64api");
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(vi.mocked(applyC64APIRuntimeConfig)).toHaveBeenCalledWith(
      "http://127.0.0.1:9999",
      undefined,
      getDeviceHostFromBaseUrl("http://127.0.0.1:9999"),
    );
  });

  it("manual discovery transitions from demo to real when probe succeeds", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await discoverConnection("manual");
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("clears a pinned Unhealthy health-check result on recovery to REAL_CONNECTED (HARD19-004)", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { getHealthCheckStateSnapshot, setHealthCheckStateSnapshot, resetHealthCheckStateSnapshot } =
      await import("../../../src/lib/diagnostics/healthCheckState");

    resetHealthCheckStateSnapshot();
    // A stale manual health check pinned the badge Unhealthy while the device was down.
    setHealthCheckStateSnapshot({
      latestResult: {
        runId: "hc-stale",
        startTimestamp: "2024-01-01T00:00:00.000Z",
        endTimestamp: "2024-01-01T00:00:01.000Z",
        totalDurationMs: 1000,
        overallHealth: "Unhealthy",
        connectivity: "Online",
        probes: {} as never,
        latency: { p50: 0, p90: 0, p99: 0 },
      } as never,
    });

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    await discoverConnection("manual");
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    // The fresh REST success contradicts the stale Unhealthy verdict; it must clear.
    expect(getHealthCheckStateSnapshot().latestResult).toBeNull();
    resetHealthCheckStateSnapshot();
  });

  it("leaves a pinned Healthy health-check result intact on reconnect (HARD19-004 clears only Unhealthy/Unavailable)", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { getHealthCheckStateSnapshot, setHealthCheckStateSnapshot, resetHealthCheckStateSnapshot } =
      await import("../../../src/lib/diagnostics/healthCheckState");

    resetHealthCheckStateSnapshot();
    setHealthCheckStateSnapshot({
      latestResult: {
        runId: "hc-healthy",
        startTimestamp: "2024-01-01T00:00:00.000Z",
        endTimestamp: "2024-01-01T00:00:01.000Z",
        totalDurationMs: 1000,
        overallHealth: "Healthy",
        connectivity: "Online",
        probes: {} as never,
        latency: { p50: 0, p90: 0, p99: 0 },
      } as never,
    });

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    await discoverConnection("manual");
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    // A Healthy verdict is left to the useHealthState trace-evidence override, not cleared here.
    expect(getHealthCheckStateSnapshot().latestResult).not.toBeNull();
    resetHealthCheckStateSnapshot();
  });

  it("verifyCurrentConnectionTarget enters demo when the feature flag and setting are enabled", async () => {
    const { getConnectionSnapshot, initializeConnectionManager, verifyCurrentConnectionTarget } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ errors: ["offline"] }), {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    const result = await verifyCurrentConnectionTarget();

    expect(result.ok).toBe(false);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("connects to real device when legacy base url is reachable", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_base_url", "http://127.0.0.1:9999");
    localStorage.removeItem("c64u_device_host");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(localStorage.getItem(DEVICE_HOST_KEY)).toBe("127.0.0.1:9999");
  });

  it("startup discovery stores the device identity returned by the successful probe", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          product: "Ultimate 64 Elite",
          firmware_version: "3.14e",
          hostname: "u64",
          unique_id: "38C1BA",
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().deviceInfo).toMatchObject({
      product: "Ultimate 64 Elite",
      firmware_version: "3.14e",
    });

    const { getSelectedSavedDeviceProductFamilySync } = await import("../../../src/lib/savedDevices/store");
    expect(getSelectedSavedDeviceProductFamilySync()).toBe("U64E");
  });

  it("traffic-derived promotion without identity fetches device identity once", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, noteReachable } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(getConnectionSnapshot().deviceInfo).toBeNull();

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          product: "C64 Ultimate",
          firmware_version: "1.1.0",
          hostname: "c64u",
          unique_id: "5D4E12",
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    noteReachable("127.0.0.1", "rest");
    await vi.advanceTimersByTimeAsync(100);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().deviceInfo).toMatchObject({
      product: "C64 Ultimate",
      firmware_version: "1.1.0",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const { getSelectedSavedDeviceProductFamilySync } = await import("../../../src/lib/savedDevices/store");
    expect(getSelectedSavedDeviceProductFamilySync()).toBe("C64U");
  });

  it("records smoke status transitions when enabled", async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { isSmokeModeEnabled, recordSmokeStatus } = await import("../../../src/lib/smoke/smokeMode");

    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(50);

    expect(recordSmokeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "REAL_CONNECTED",
        mode: "real",
      }),
    );
  });

  it("does not retry discovery through a raw fetch fallback when the gateway probe fails", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const ok = await probeOnce();

    expect(ok).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to demo mode after real connection is sticky", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, isRealDeviceStickyLockEnabled } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(isRealDeviceStickyLockEnabled()).toBe(true);

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    void discoverConnection("settings");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(isRealDeviceStickyLockEnabled()).toBe(true);
  });

  it("rejects probe payload without product identity", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
  });

  it("verifyCurrentConnectionTarget enters demo only when the feature flag allows it and the user setting enables it", async () => {
    const { getConnectionSnapshot, initializeConnectionManager, verifyCurrentConnectionTarget } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    const result = await verifyCurrentConnectionTarget();

    expect(result.ok).toBe(false);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("returns false when probe exceeds timeout", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_: RequestInfo, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        setTimeout(() => {
          resolve(
            new Response(JSON.stringify({ errors: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }, 200);
      });
    });

    const resultPromise = probeOnce({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBe(false);
  });

  it("uses configured probe timeout when not provided", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    vi.mocked(loadDiscoveryProbeTimeoutMs).mockReturnValue(40);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_: RequestInfo, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        setTimeout(() => {
          resolve(
            new Response(JSON.stringify({ errors: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }, 200);
      });
    });

    const resultPromise = probeOnce();
    await vi.advanceTimersByTimeAsync(60);
    await expect(resultPromise).resolves.toBe(false);
  });

  it("connects to real device before discovery window expires", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("discovery timeout transitions offline even if a probe is still in flight", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }, 500);
        }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");

    await vi.advanceTimersByTimeAsync(250);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");

    await vi.advanceTimersByTimeAsync(400);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("switches from demo to real device on background probe success", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchStub = vi.mocked(fetch);
    fetchStub
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: ["offline"] }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(250);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    await discoverConnection("background");
    await vi.runAllTimersAsync();

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("prevents overlapping background probes and preserves in-flight success", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchStub = vi.mocked(fetch);
    fetchStub.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let abortCount = 0;
    fetchStub.mockImplementation((_: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          abortCount += 1;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        const onAbort = () => {
          abortCount += 1;
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }, 150);
      });
    });

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(250);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    const firstProbe = discoverConnection("background");
    const secondProbe = discoverConnection("background");
    await vi.advanceTimersByTimeAsync(220);
    await Promise.all([firstProbe, secondProbe]);

    expect(abortCount).toBe(0);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("coalesces overlapping manual discovery clicks instead of starting a second probe", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchStub = vi.mocked(fetch);
    fetchStub.mockImplementation(
      () =>
        new Promise<Response>((_, reject) => {
          setTimeout(() => reject(new TypeError("manual probe failed")), 150);
        }),
    );

    await initializeConnectionManager();

    const firstManual = discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(10);
    const secondManual = discoverConnection("manual");

    await vi.advanceTimersByTimeAsync(250);
    await Promise.all([firstManual, secondManual]);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("preserves transition invariants under mixed trigger stress", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, isRealDeviceStickyLockEnabled } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(120);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchStub = vi.mocked(fetch);
    let probeCount = 0;
    fetchStub.mockImplementation(() => {
      probeCount += 1;
      const shouldSucceed = probeCount % 3 === 0;
      return Promise.resolve(
        new Response(
          JSON.stringify(shouldSucceed ? { product: "C64 Ultimate", errors: [] } : { errors: ["offline"] }),
          {
            status: shouldSucceed ? 200 : 503,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    });

    await initializeConnectionManager();

    const triggers: Array<"startup" | "manual" | "settings" | "background"> = [
      "startup",
      "background",
      "manual",
      "settings",
      "background",
      "manual",
      "settings",
      "background",
      "manual",
      "startup",
    ];

    for (const trigger of triggers) {
      await discoverConnection(trigger);
      await vi.advanceTimersByTimeAsync(250);
      const current = getConnectionSnapshot();

      if (current.demoInterstitialVisible) {
        expect(current.state).toBe("DEMO_ACTIVE");
      }

      if (current.state === "REAL_CONNECTED") {
        expect(current.demoInterstitialVisible).toBe(false);
      }

      if (isRealDeviceStickyLockEnabled()) {
        expect(current.state).not.toBe("DEMO_ACTIVE");
      }
    }
  });

  it("does not auto-enable demo when the feature flag is disabled", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: false } } as never);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: ["Device unreachable"] }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(300);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("rejects payload with non-empty errors array", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          product: "C64 Ultimate",
          errors: ["something wrong"],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(probeOnce()).resolves.toBe(false);
  });

  it("rejects payload with empty product string", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "   ", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
  });

  it("rejects payload with no product field and no errors", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
  });

  it("rejects probe when HTTP status is not ok", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
  });

  it("raises the password challenge when a discovery probe gets 403 (HARD9-001)", async () => {
    const { probeOnce, getConnectionSnapshot } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "c64u");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ errors: ["forbidden"] }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
    expect(notifyAuthRequired).toHaveBeenCalledTimes(1);
    expect(notifyAuthRequired).toHaveBeenCalledWith(expect.objectContaining({ host: "c64u" }));
    expect(getConnectionSnapshot().lastProbeError).toBe("Password required");
  });

  it("keeps startup discovery recoverable when every probe is rejected for auth (HARD9-001)", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "c64u");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(600);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ errors: ["forbidden"] }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    const discovery = discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(700);
    await discovery;

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(getConnectionSnapshot().lastProbeError).toBe("Password required");
    expect(notifyAuthRequired).toHaveBeenCalledWith(expect.objectContaining({ host: "c64u" }));
  });

  it("does not raise the password challenge for a non-auth HTTP failure (500)", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "c64u");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
    expect(notifyAuthRequired).not.toHaveBeenCalled();
  });

  it("handles non-JSON content type by returning null payload (healthy if response ok)", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response("OK", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    // Non-JSON means payload is null, isProbePayloadHealthy(null) => false
    await expect(probeOnce()).resolves.toBe(false);
  });

  it("manual probe without auto-demo transitions to OFFLINE_NO_DEMO", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: false } } as never);

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    await discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(5000);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("background probe on READY state does nothing", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");

    // Background probe should not change state when already REAL_CONNECTED
    await discoverConnection("background");
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("automatic demo fallback applies mock routing details when available", async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } = await import("../../../src/lib/c64api");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    startMockServer.mockResolvedValue({
      baseUrl: "http://127.0.0.1:7777",
      ftpPort: 21,
    });
    getActiveMockBaseUrl.mockReturnValue("http://127.0.0.1:7777");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(vi.mocked(applyC64APIRuntimeConfig)).toHaveBeenCalledWith(
      "http://127.0.0.1:7777",
      undefined,
      getDeviceHostFromBaseUrl("http://127.0.0.1:7777"),
    );
  });

  it("automatic demo fallback shows the discovery interstitial", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    localStorage.setItem("c64u_device_host", "192.168.1.42");
    localStorage.removeItem("c64u_has_password");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(true);
  });

  it("reconnection controller invariant: background discovery inactive in REAL_CONNECTED state", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");

    // Background probe must not change the state when already real-connected
    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("automatic demo fallback is available only when the feature flag permits it and the user setting enables it", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(true);
  });

  it("background rediscovery switches from auto-demo fallback to a real device when demo is not pinned", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("keeps demo active after the user explicitly pins demo mode before background rediscovery succeeds", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, pinDemoModeByUserChoice } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    pinDemoModeByUserChoice();
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("pinDemoModeByUserChoice immediately activates demo mode from the offline interstitial", async () => {
    const { applyC64APIRuntimeConfig } = await import("../../../src/lib/c64api");
    const { getConnectionSnapshot, initializeConnectionManager, pinDemoModeByUserChoice } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    startMockServer.mockResolvedValue({
      baseUrl: "http://127.0.0.1:7777",
      ftpPort: 2121,
    });
    getActiveMockBaseUrl.mockReturnValue("http://127.0.0.1:7777");
    getActiveMockFtpPort.mockReturnValue(2121);

    await initializeConnectionManager();
    expect(getConnectionSnapshot().state).toBe("UNKNOWN");

    await pinDemoModeByUserChoice();

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(startMockServer).toHaveBeenCalled();
    expect(vi.mocked(applyC64APIRuntimeConfig)).toHaveBeenCalledWith(
      "http://127.0.0.1:7777",
      undefined,
      "127.0.0.1:7777",
    );
  });

  it("normalizeUrl returns original value when given an invalid URL", async () => {
    const addLogSpy = vi.spyOn(logging, "addLog");
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    // Set an invalid device host that can't be parsed as a URL
    localStorage.setItem("c64u_device_host", ":::invalid");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await probeOnce();
    // normalizeUrl logs a warning for invalid URLs
    addLogSpy.mockRestore();
  });

  it("settings trigger performs startup-style discovery with polling", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("settings");
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("settings trigger falls back to demo when probes fail", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("settings");
    await vi.advanceTimersByTimeAsync(300);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("probeOnce respects pre-aborted outer signal", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const abort = new AbortController();
    abort.abort();

    const result = await probeOnce({ signal: abort.signal });
    expect(result).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("demo fallback uses stored device host when no mock server is active", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { applyC64APIRuntimeConfig } = await import("../../../src/lib/c64api");

    // Mock server throws but getActiveMockBaseUrl returns null
    startMockServer.mockRejectedValue(new Error("not available"));
    getActiveMockBaseUrl.mockReturnValue(null);

    localStorage.setItem("c64u_device_host", "192.168.1.100");
    localStorage.removeItem("c64u_has_password");
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    const discovery = discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    await discovery;

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    // Should fallback to stored host-based URL
    expect(vi.mocked(applyC64APIRuntimeConfig)).toHaveBeenCalledWith(
      "http://192.168.1.100",
      undefined,
      "192.168.1.100",
    );
  });

  it("demo fallback applies FTP port override when mock server provides one", async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    startMockServer.mockResolvedValue({
      baseUrl: "http://127.0.0.1:7777",
      ftpPort: 2121,
    });
    getActiveMockBaseUrl.mockReturnValue("http://127.0.0.1:7777");
    getActiveMockFtpPort.mockReturnValue(2121);

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(startMockServer).toHaveBeenCalled();
  });

  it("background probe failed outcome does not change state", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(300);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    // Background probe also fails - should stay DEMO_ACTIVE
    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("probeOnce returns false for non-object payload", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(null), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
  });

  it("probeOnce returns false for primitive payload", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(42), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(false);
  });

  it("smoke mock target bypasses normal discovery and uses mock server", async () => {
    const { getSmokeConfig, isSmokeModeEnabled } = await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(getSmokeConfig as any).mockReturnValue({
      target: "mock",
      host: "localhost",
    });
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);

    startMockServer.mockResolvedValue({
      baseUrl: "http://127.0.0.1:8888",
      ftpPort: null,
    });
    getActiveMockBaseUrl.mockReturnValue("http://127.0.0.1:8888");

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(startMockServer).toHaveBeenCalled();
  });

  it("exports CONNECTION_CONSTANTS with expected values", async () => {
    const { CONNECTION_CONSTANTS } = await import("../../../src/lib/connection/connectionManager");
    expect(CONNECTION_CONSTANTS.STARTUP_PROBE_INTERVAL_MS).toBe(700);
    expect(CONNECTION_CONSTANTS.PROBE_REQUEST_TIMEOUT_MS).toBe(2500);
  });

  it("subscribe and unsubscribe connection listeners", async () => {
    const { subscribeConnection, getConnectionSnapshot } =
      await import("../../../src/lib/connection/connectionManager");
    const listener = vi.fn();
    const unsubscribe = subscribeConnection(listener);
    expect(typeof unsubscribe).toBe("function");
    // getConnectionSnapshot should return the current state
    expect(getConnectionSnapshot().state).toBeDefined();
    unsubscribe();
  });

  it("promotes an offline active host when REST reports it reachable", async () => {
    localStorage.setItem(DEVICE_HOST_KEY, "u64");
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, noteReachable } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("manual");
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");

    noteReachable("u64", "rest", {
      product: "Ultimate 64 Elite",
      firmware_version: "3.14e",
      hostname: "u64",
      unique_id: "38C1BA",
      errors: [],
    });

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().deviceInfo?.product).toBe("Ultimate 64 Elite");
  });

  it("does not stamp a late device identity whose unique id differs from the selected device during a switch (HARD12-011)", async () => {
    const { getConnectionSnapshot, initializeConnectionManager, noteReachable, setSavedDeviceSwitchProbeWindow } =
      await import("../../../src/lib/connection/connectionManager");
    const { addSavedDevice, selectSavedDevice, getSavedDevicesSnapshot, getSelectedSavedDeviceProductFamilySync } =
      await import("../../../src/lib/savedDevices/store");

    addSavedDevice({
      id: "hard12-011-new-device",
      name: "New Lab",
      host: "shared-host",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64E",
      lastKnownHostname: "shared-host",
      lastKnownUniqueId: "NEW-UID",
      hasPassword: false,
    });
    selectSavedDevice("hard12-011-new-device");
    localStorage.setItem(DEVICE_HOST_KEY, "shared-host");
    // initializeConnectionManager resets the snapshot state to "UNKNOWN" so
    // noteReachable skips its promotion path and only attempts the identity stamp.
    await initializeConnectionManager();

    // Open the saved-device switch window (selection flipped, runtime config not
    // yet applied): a late /v1/info from the PREVIOUS device (unique id OLD-UID)
    // arrives over the still-active host.
    setSavedDeviceSwitchProbeWindow(true);
    noteReachable("shared-host", "rest", {
      product: "C64 Ultimate",
      firmware_version: "1.1.0",
      hostname: "old-c64",
      unique_id: "OLD-UID",
      errors: [],
    });
    setSavedDeviceSwitchProbeWindow(false);

    // The connection snapshot DID receive the deviceInfo (the event was processed),
    // but the selected saved device's identity must NOT be overwritten by it.
    expect(getConnectionSnapshot().deviceInfo?.product).toBe("C64 Ultimate");
    expect(getSavedDevicesSnapshot().verifiedByDeviceId["hard12-011-new-device"]?.product).toBeUndefined();
    expect(getSelectedSavedDeviceProductFamilySync()).toBe("U64E");
  });

  it("dismissDemoInterstitial handles sessionStorage.setItem throwing", async () => {
    const { dismissDemoInterstitial, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    await initializeConnectionManager();
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("sessionStorage", throwing);
    expect(() => dismissDemoInterstitial()).not.toThrow();
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    vi.unstubAllGlobals();
  });

  it("probeOnce returns false when response has no content-type header", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    // null body → no content-type header → parseProbePayload returns null → isProbePayloadHealthy(null) = false
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    await expect(probeOnce()).resolves.toBe(false);
  });

  it("probeOnce uses the C64API system probe flags", async () => {
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("NODE_ENV", "production");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const { C64API } = await import("../../../src/lib/c64api");
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockResolvedValue({
      product: "C64 Ultimate",
      errors: [],
    } as any);

    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");

    await expect(probeOnce({ timeoutMs: 1234 })).resolves.toBe(true);
    expect(getInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 1234,
        __c64uIntent: "system",
        __c64uAllowDuringDiscovery: true,
        __c64uAllowDuringError: true,
      }),
    );

    getInfoSpy.mockRestore();
  });

  it("probeInfoOnce uses the C64API system probe flags", async () => {
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("NODE_ENV", "production");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const { C64API } = await import("../../../src/lib/c64api");
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockResolvedValue({
      product: "C64 Ultimate",
      errors: [],
    } as any);

    const { probeInfoOnce } = await import("../../../src/lib/connection/connectionManager");

    await expect(probeInfoOnce({ timeoutMs: 2345 })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        error: null,
      }),
    );
    expect(getInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 2345,
        __c64uIntent: "system",
        __c64uAllowDuringDiscovery: true,
        __c64uAllowDuringError: true,
      }),
    );

    getInfoSpy.mockRestore();
  });

  it("verifyCurrentConnectionTarget uses switch probe flags for explicit device targets", async () => {
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("NODE_ENV", "production");
    localStorage.setItem("c64u_device_host", "c64u");
    localStorage.removeItem("c64u_has_password");

    const { C64API } = await import("../../../src/lib/c64api");
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockResolvedValue({
      product: "Ultimate 64",
      errors: [],
    } as any);

    const { getConnectionSnapshot, initializeConnectionManager, verifyCurrentConnectionTarget } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    const result = await verifyCurrentConnectionTarget({
      deviceHost: "u64",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
      }),
    );
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        __c64uIntent: "system",
        __c64uAllowDuringDiscovery: true,
        __c64uAllowDuringError: true,
      }),
    );

    getInfoSpy.mockRestore();
  });

  it("clears stale device identity as soon as a device switch starts", async () => {
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("NODE_ENV", "production");
    localStorage.setItem("c64u_device_host", "c64u");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          product: "C64 Ultimate",
          firmware_version: "1.1.0",
          hostname: "c64u",
          unique_id: "5D4E12",
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, verifyCurrentConnectionTarget } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().deviceInfo?.hostname).toBe("c64u");

    let resolveSwitchProbe: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveSwitchProbe = resolve;
      }),
    );

    const switchPromise = verifyCurrentConnectionTarget({
      deviceHost: "u64",
    });

    expect(getConnectionSnapshot()).toMatchObject({
      state: "DISCOVERING",
      deviceInfo: null,
    });

    resolveSwitchProbe(
      new Response(
        JSON.stringify({
          product: "Ultimate 64 Elite",
          firmware_version: "3.14e",
          hostname: "Ultimate-64-Elite-F83C87",
          unique_id: "38C1BA",
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(switchPromise).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(getConnectionSnapshot().deviceInfo?.hostname).toBe("Ultimate-64-Elite-F83C87");
  });

  it("initializeConnectionManager logs warning when stopDemoServer throws", async () => {
    stopMockServer.mockRejectedValueOnce(new Error("stop failed"));
    const { initializeConnectionManager } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    await expect(initializeConnectionManager()).resolves.toBeUndefined();
  });

  it("background probe ok logs smoke info when smoke mode enabled", async () => {
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    // Reach DEMO_ACTIVE with smoke off (autoDemoEnabled = true)
    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(300);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    // Enable smoke mode before the background probe succeeds
    const { isSmokeModeEnabled } = await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "U64" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("background probe fail logs smoke warn when smoke mode enabled", async () => {
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);

    // Reach DEMO_ACTIVE with smoke off
    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(300);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    // Enable smoke mode before the background probe (which also fails)
    const { isSmokeModeEnabled } = await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);
    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("startup discovery logs smoke info when probe succeeds in smoke mode", async () => {
    const { isSmokeModeEnabled } = await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "U64" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("startup discovery logs smoke warn when probe fails in smoke mode", async () => {
    const { isSmokeModeEnabled } = await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(300);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(600);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("continues discovery after a probe preamble rejection clears the in-flight latch", async () => {
    const addLogSpy = vi.spyOn(logging, "addLog");
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(3000);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "U64", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    vi.mocked(loadStoredPassword).mockRejectedValueOnce(new Error("secure storage unavailable"));
    vi.mocked(loadStoredPassword).mockResolvedValue(null);
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(0);

    expect(getConnectionSnapshot()).toMatchObject({
      state: "DISCOVERING",
      lastProbeError: "secure storage unavailable",
    });
    expect(addLogSpy).toHaveBeenCalledWith(
      "warn",
      "Discovery probe failed before completion",
      expect.objectContaining({ trigger: "startup", error: "secure storage unavailable" }),
    );

    await vi.advanceTimersByTimeAsync(1500);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    addLogSpy.mockRestore();
  });

  it("transitionToDemoActive: shouldStartDemoServer false when demoServerStartedThisSession", async () => {
    startMockServer.mockResolvedValue({
      baseUrl: "http://127.0.0.1:7777",
      ftpPort: 2121,
    });
    getActiveMockBaseUrl.mockReturnValue("http://127.0.0.1:7777");
    getActiveMockFtpPort.mockReturnValue(2121);

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    // Demo server was started; second transition should skip startMockServer
    const callCount = startMockServer.mock.calls.length;
    void discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(100);
    expect(startMockServer.mock.calls.length).toBe(callCount);
  });

  it("probeOnce with timeoutMs:0 skips AbortController and timeout (controller=null paths)", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    // timeoutMs=0 makes probeWithFetch: controller=null, timeoutId=null
    // Covers BRDA FALSE branches for: timeoutMs ternaries (lines 121, 130)
    // and the `if (timeoutId) clearTimeout(timeoutId)` FALSE branch (line 144)
    // and the `controller ? {...} : outerSignal ? {...} : {}` empty-spread path (line 133)
    await expect(probeOnce({ timeoutMs: 0 })).resolves.toBe(true);
  });

  it("probeOnce with timeoutMs:0 and outerSignal covers outerSignal branch when controller is null", async () => {
    const { probeOnce } = await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const outerAbort = new AbortController();
    // controller=null (timeoutMs=0), outerSignal is set → covers
    // `controller ? {...} : outerSignal ? { signal: outerSignal } : {}` TRUE for outerSignal (line 133)
    await expect(probeOnce({ timeoutMs: 0, signal: outerAbort.signal })).resolves.toBe(true);
  });

  it("test-probe mode avoids starting the demo server when no mock override is present", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, isRealDeviceStickyLockEnabled } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");
    (window as Window & { __c64uTestProbeEnabled?: boolean; __c64uExpectedBaseUrl?: string }).__c64uTestProbeEnabled =
      true;
    (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:9999/";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(startMockServer).not.toHaveBeenCalled();
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(isRealDeviceStickyLockEnabled()).toBe(false);

    delete (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
    delete (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl;
  });

  it("test-probe mode seeds runtime routing from the expected base URL during initialization", async () => {
    const { initializeConnectionManager } = await import("../../../src/lib/connection/connectionManager");
    const { applyC64APIRuntimeConfig } = await import("../../../src/lib/c64api");

    localStorage.setItem(DEVICE_HOST_KEY, "c64u");
    (window as Window & { __c64uTestProbeEnabled?: boolean; __c64uExpectedBaseUrl?: string }).__c64uTestProbeEnabled =
      true;
    (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:9999/";

    await initializeConnectionManager();

    expect(applyC64APIRuntimeConfig).toHaveBeenCalledWith("http://127.0.0.1:9999/", undefined, "127.0.0.1:9999");

    delete (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
    delete (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl;
  });

  it("pinDemoModeByUserChoice tolerates a missing sessionStorage object", async () => {
    const originalSessionStorage = globalThis.sessionStorage;
    // @ts-expect-error intentionally removing browser storage for branch coverage
    delete globalThis.sessionStorage;

    const { getConnectionSnapshot, pinDemoModeByUserChoice } =
      await import("../../../src/lib/connection/connectionManager");

    await expect(pinDemoModeByUserChoice()).resolves.toBeUndefined();
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);

    Object.defineProperty(globalThis, "sessionStorage", {
      value: originalSessionStorage,
      configurable: true,
      writable: true,
    });
  });

  it("noteReachable clears connectivity error toasts for the recovered active host (ERROR_POLICY §6)", async () => {
    localStorage.setItem(DEVICE_HOST_KEY, "u64");
    const { clearConnectivityErrorToastsForHost } = await import("../../../src/lib/uiErrors");
    const { noteReachable } = await import("../../../src/lib/connection/connectionManager");
    vi.mocked(clearConnectivityErrorToastsForHost).mockClear();

    noteReachable("u64", "rest" as never);

    expect(vi.mocked(clearConnectivityErrorToastsForHost)).toHaveBeenCalledWith("u64");
  });

  it("noteReachable does not clear toasts for a non-active host (ERROR_POLICY §6)", async () => {
    localStorage.setItem(DEVICE_HOST_KEY, "u64");
    const { clearConnectivityErrorToastsForHost } = await import("../../../src/lib/uiErrors");
    const { noteReachable } = await import("../../../src/lib/connection/connectionManager");
    vi.mocked(clearConnectivityErrorToastsForHost).mockClear();

    noteReachable("some-other-host", "rest" as never);

    expect(vi.mocked(clearConnectivityErrorToastsForHost)).not.toHaveBeenCalled();
  });
});
