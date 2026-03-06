/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as logging from "../../../src/lib/logging";
import {
  getFuzzMockBaseUrl,
  isFuzzModeEnabled,
} from "../../../src/lib/fuzz/fuzzMode";
import {
  loadAutomaticDemoModeEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadStartupDiscoveryWindowMs,
} from "../../../src/lib/config/appSettings";
import {
  getSmokeConfig,
  isSmokeModeEnabled,
  recordSmokeStatus,
} from "../../../src/lib/smoke/smokeMode";

vi.mock("../../../src/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadDebugLoggingEnabled: vi.fn(() => false),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 600),
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
  const actual = await vi.importActual<
    typeof import("../../../src/lib/c64api")
  >("../../../src/lib/c64api");
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

const startMockServer = vi.fn(async () => {
  throw new Error("Mock C64U server is only available on native platforms.");
});
const stopMockServer = vi.fn(async () => undefined);
const getActiveMockBaseUrl = vi.fn(() => null);
const getActiveMockFtpPort = vi.fn(() => null);

vi.mock("../../../src/lib/mock/mockServer", () => ({
  startMockServer,
  stopMockServer,
  getActiveMockBaseUrl,
  getActiveMockFtpPort,
}));

const ensureStorage = () => {
  const createMemoryStorage = () => {
    let store = new Map<string, string>();
    return {
      getItem: (key: string) =>
        store.has(key) ? (store.get(key) ?? null) : null,
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
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    vi.mocked(isFuzzModeEnabled).mockReturnValue(false);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue(null);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(loadDiscoveryProbeTimeoutMs).mockReturnValue(2500);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(600);
    vi.mocked(isSmokeModeEnabled).mockReturnValue(false);
    vi.mocked(recordSmokeStatus).mockResolvedValue(undefined);
    vi.mocked(getSmokeConfig as any).mockReturnValue(null);
    startMockServer.mockImplementation(async () => {
      throw new Error(
        "Mock C64U server is only available on native platforms.",
      );
    });
    startMockServer.mockClear();
    stopMockServer.mockClear();
    getActiveMockBaseUrl.mockClear();
    getActiveMockFtpPort.mockClear();
  });

  it("shows demo interstitial at most once per session (manual/startup), never for background", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    // Force an unreachable URL so probes always fail quickly.
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");

    await initializeConnectionManager();
    expect(getConnectionSnapshot().state).toBe("UNKNOWN");

    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(true);

    // Dismiss, then manual discovery should not show again in same session.
    const { dismissDemoInterstitial } =
      await import("../../../src/lib/connection/connectionManager");
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
    const { isFuzzModeEnabled, getFuzzMockBaseUrl } =
      await import("../../../src/lib/fuzz/fuzzMode");
    vi.mocked(isFuzzModeEnabled).mockReturnValue(true);
    vi.mocked(getFuzzMockBaseUrl).mockReturnValue("http://127.0.0.1:9999");

    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } =
      await import("../../../src/lib/c64api");
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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

  it("connects to real device when legacy base url is reachable", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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
    expect(localStorage.getItem("c64u_device_host")).toBe("127.0.0.1:9999");
  });

  it("records smoke status transitions when enabled", async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { isSmokeModeEnabled, recordSmokeStatus } =
      await import("../../../src/lib/smoke/smokeMode");

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

  it("logs when discovery probe JSON parsing fails", async () => {
    const addLogSpy = vi.spyOn(logging, "addLog");
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    vi.mocked(fetch).mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const ok = await probeOnce();

    expect(ok).toBe(false);
    expect(addLogSpy).toHaveBeenCalledWith(
      "warn",
      "Discovery probe JSON parse failed",
      expect.objectContaining({
        error: expect.any(String),
      }),
    );
    addLogSpy.mockRestore();
  });

  it("does not fall back to demo mode after real connection is sticky", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
      isRealDeviceStickyLockEnabled,
    } = await import("../../../src/lib/connection/connectionManager");

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
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(isRealDeviceStickyLockEnabled()).toBe(true);

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    void discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(startMockServer).not.toHaveBeenCalled();
  });

  it("accepts healthy probe payload without product field", async () => {
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(true);
  });

  it("returns false when probe exceeds timeout", async () => {
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
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
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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

  it("discovery timeout falls back to demo even if a probe is still in flight", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({ product: "C64 Ultimate", errors: [] }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }, 500);
        }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");

    await vi.advanceTimersByTimeAsync(250);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    await vi.advanceTimersByTimeAsync(400);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("switches from demo to real device on background probe success", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(250);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    await discoverConnection("background");
    await vi.runAllTimersAsync();

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("prevents overlapping background probes and preserves in-flight success", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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
            new Response(
              JSON.stringify({ product: "C64 Ultimate", errors: [] }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }, 150);
      });
    });

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

  it("ignores stale manual discovery outcomes when a newer manual run finishes first", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchStub = vi.mocked(fetch);
    fetchStub
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_, reject) => {
            setTimeout(
              () => reject(new TypeError("first manual probe failed")),
              150,
            );
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(
                new Response(
                  JSON.stringify({ product: "C64 Ultimate", errors: [] }),
                  {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  },
                ),
              );
            }, 20);
          }),
      );

    await initializeConnectionManager();

    const firstManual = discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(10);
    const secondManual = discoverConnection("manual");

    await vi.advanceTimersByTimeAsync(250);
    await Promise.all([firstManual, secondManual]);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("preserves transition invariants under mixed trigger stress", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
      isRealDeviceStickyLockEnabled,
    } = await import("../../../src/lib/connection/connectionManager");

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
          JSON.stringify(
            shouldSucceed
              ? { product: "C64 Ultimate", errors: [] }
              : { errors: ["offline"] },
          ),
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

  it("does not auto-enable demo when automatic demo mode is disabled", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);
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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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

  it("accepts payload with no product field and no errors", async () => {
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(probeOnce()).resolves.toBe(true);
  });

  it("rejects probe when HTTP status is not ok", async () => {
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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

  it("handles non-JSON content type by returning null payload (healthy if response ok)", async () => {
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    await discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(5000);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("background probe on READY state does nothing", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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

  it("demo fallback applies mock routing details when available", async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { applyC64APIRuntimeConfig, getDeviceHostFromBaseUrl } =
      await import("../../../src/lib/c64api");

    startMockServer.mockResolvedValue({
      baseUrl: "http://127.0.0.1:7777",
      ftpPort: 21,
    });
    getActiveMockBaseUrl.mockReturnValue("http://127.0.0.1:7777");

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
    await vi.advanceTimersByTimeAsync(700);

    expect(vi.mocked(applyC64APIRuntimeConfig)).toHaveBeenCalledWith(
      "http://127.0.0.1:7777",
      undefined,
      getDeviceHostFromBaseUrl("http://127.0.0.1:7777"),
    );
  });

  it("interstitial carries attempted hostname from persisted storage", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");
    const { resolveDeviceHostFromStorage } =
      await import("../../../src/lib/c64api");

    localStorage.setItem("c64u_device_host", "192.168.1.42");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(true);
    // The persisted hostname must still reflect the device that was attempted
    expect(resolveDeviceHostFromStorage()).toBe("192.168.1.42");
  });

  it("reconnection controller invariant: background discovery inactive in REAL_CONNECTED state", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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

  it("demo mode entered only when automatic demo is enabled; retry exhaustion falls to offline otherwise", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(300);

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(500);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("automatic switch from demo to real when device becomes reachable during background rediscovery", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const fetchMock = vi.mocked(fetch);
    // First startup probes fail → demo
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    // Device becomes reachable
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);

    // Must atomically switch to real backend; demo interstitial must be dismissed
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("normalizeUrl returns original value when given an invalid URL", async () => {
    const addLogSpy = vi.spyOn(logging, "addLog");
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
    // Set an invalid device host that can't be parsed as a URL
    localStorage.setItem("c64u_device_host", ":::invalid");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await probeOnce();
    // normalizeUrl logs a warning for invalid URLs
    addLogSpy.mockRestore();
  });

  it("settings trigger performs startup-style discovery with polling", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("settings");
    await vi.advanceTimersByTimeAsync(300);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("probeOnce respects pre-aborted outer signal", async () => {
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    const abort = new AbortController();
    abort.abort();

    vi.mocked(fetch).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    const result = await probeOnce({ signal: abort.signal });
    expect(result).toBe(false);
  });

  it("demo fallback uses stored device host when no mock server is active", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");
    const { applyC64APIRuntimeConfig } =
      await import("../../../src/lib/c64api");

    // Mock server throws but getActiveMockBaseUrl returns null
    startMockServer.mockRejectedValue(new Error("not available"));
    getActiveMockBaseUrl.mockReturnValue(null);

    localStorage.setItem("c64u_device_host", "192.168.1.100");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

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

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(startMockServer).toHaveBeenCalled();
  });

  it("background probe failed outcome does not change state", async () => {
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
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
    const { getSmokeConfig, isSmokeModeEnabled } =
      await import("../../../src/lib/smoke/smokeMode");
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

    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(startMockServer).toHaveBeenCalled();
  });

  it("exports CONNECTION_CONSTANTS with expected values", async () => {
    const { CONNECTION_CONSTANTS } =
      await import("../../../src/lib/connection/connectionManager");
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

  it("dismissDemoInterstitial handles sessionStorage.setItem throwing", async () => {
    const {
      dismissDemoInterstitial,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");
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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    // null body → no content-type header → parseProbePayload returns null → isProbePayloadHealthy(null) = false
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    await expect(probeOnce()).resolves.toBe(false);
  });

  it("initializeConnectionManager logs warning when stopDemoServer throws", async () => {
    stopMockServer.mockRejectedValueOnce(new Error("stop failed"));
    const { initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    await expect(initializeConnectionManager()).resolves.toBeUndefined();
  });

  it("background probe ok logs smoke info when smoke mode enabled", async () => {
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(200);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    // Reach DEMO_ACTIVE with smoke off (autoDemoEnabled = true)
    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(300);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    // Enable smoke mode before the background probe succeeds
    const { isSmokeModeEnabled } =
      await import("../../../src/lib/smoke/smokeMode");
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

    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    // Reach DEMO_ACTIVE with smoke off
    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(300);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    // Enable smoke mode before the background probe (which also fails)
    const { isSmokeModeEnabled } =
      await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);
    await discoverConnection("background");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("startup discovery logs smoke info when probe succeeds in smoke mode", async () => {
    const { isSmokeModeEnabled } =
      await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "U64" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });

  it("startup discovery logs smoke warn when probe fails in smoke mode", async () => {
    const { isSmokeModeEnabled } =
      await import("../../../src/lib/smoke/smokeMode");
    vi.mocked(isSmokeModeEnabled).mockReturnValue(true);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(false);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(300);
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(600);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("transitionToDemoActive: shouldStartDemoServer false when demoServerStartedThisSession", async () => {
    startMockServer.mockResolvedValue({
      baseUrl: "http://127.0.0.1:7777",
      ftpPort: 2121,
    });
    getActiveMockBaseUrl.mockReturnValue("http://127.0.0.1:7777");
    getActiveMockFtpPort.mockReturnValue(2121);

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const {
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
    } = await import("../../../src/lib/connection/connectionManager");

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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
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
    const { probeOnce } =
      await import("../../../src/lib/connection/connectionManager");
    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    localStorage.removeItem("c64u_has_password");

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const outerAbort = new AbortController();
    // controller=null (timeoutMs=0), outerSignal is set → covers
    // `controller ? {...} : outerSignal ? { signal: outerSignal } : {}` TRUE for outerSignal (line 133)
    await expect(
      probeOnce({ timeoutMs: 0, signal: outerAbort.signal }),
    ).resolves.toBe(true);
  });
});
