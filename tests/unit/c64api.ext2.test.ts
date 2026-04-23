/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate device
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node
// Targeted branch coverage for c64api.ts utility functions and request paths.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  C64API,
  updateC64APIConfig,
  getDeviceHostFromBaseUrl,
  normalizeDeviceHost,
  applyC64APIRuntimeConfig,
  resolveDeviceHostFromStorage,
} from "@/lib/c64api";
import { addErrorLog, addLog } from "@/lib/logging";

const DEVICE_HOST_KEY = "c64u_device_host";

// ── Node environment shims ─────────────────────────────────────────────────
const ensureWindow = () => {
  if (typeof window !== "undefined") return;
  const target = new EventTarget();
  const windowMock = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => target.addEventListener(type, listener, options),
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => target.removeEventListener(type, listener, options),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    location: { origin: "http://localhost" },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  Object.defineProperty(globalThis, "window", {
    value: windowMock,
    configurable: true,
  });
  if (typeof (globalThis as { CustomEvent?: typeof CustomEvent }).CustomEvent === "undefined") {
    class CustomEventShim<T = unknown> extends Event {
      detail?: T;
      constructor(type: string, params?: CustomEventInit<T>) {
        super(type, params);
        this.detail = params?.detail;
      }
    }
    Object.defineProperty(globalThis, "CustomEvent", {
      value: CustomEventShim,
      configurable: true,
    });
  }
};

const ensureLocalStorage = () => {
  if (typeof localStorage !== "undefined") return;
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
};

ensureWindow();
ensureLocalStorage();

// Suppress unhandled AbortError rejections that leak from internal dedupe/retry
// promise chains inside c64api.ts.
const abortUnhandledRejectionHandler = (reason: unknown) => {
  const error = reason as { name?: string; message?: string };
  if (error?.name === "AbortError" || error?.message === "The operation was aborted") {
    // swallow — expected from abort test paths
  }
};

// ── Fetch mock ─────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
Object.defineProperty(globalThis, "fetch", {
  value: fetchMock,
  configurable: true,
});
const getFetchMock = () => fetchMock as unknown as ReturnType<typeof vi.fn>;

// ── Module mocks ──────────────────────────────────────────────────────────
vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details?: Record<string, unknown>) => ({
    ...details,
    error: (error as Error).message,
  })),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "web"),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock("@/lib/fuzz/fuzzMode", () => ({
  isFuzzModeEnabled: vi.fn(() => false),
  isFuzzSafeBaseUrl: vi.fn(() => true),
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  isSmokeModeEnabled: vi.fn(() => false),
  isSmokeReadOnlyEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  runWithImplicitAction: vi.fn((_name: string, fn: (ctx: unknown) => unknown) => fn({})),
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordRestRequest: vi.fn(),
  recordRestResponse: vi.fn(),
  recordTraceError: vi.fn(),
}));

vi.mock("@/lib/tracing/failureTaxonomy", () => ({
  classifyError: vi.fn(() => ({
    failureClass: "unknown",
    category: "unknown",
  })),
}));

vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  withRestInteraction: vi.fn((_meta: unknown, handler: () => unknown) => handler()),
}));

vi.mock("@/lib/deviceInteraction/deviceStateStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deviceInteraction/deviceStateStore")>();
  return {
    ...actual,
    getDeviceStateSnapshot: vi.fn(() => ({
      state: "READY",
      connectionState: "REAL_CONNECTED",
      busyCount: 0,
      lastUpdatedAtMs: Date.now(),
      lastErrorMessage: null,
      lastSuccessAtMs: null,
      circuitOpenUntilMs: null,
    })),
  };
});

vi.mock("@/lib/secureStorage", () => ({
  setPassword: vi.fn(async () => {
    localStorage.setItem("c64u_has_password", "1");
  }),
  getPassword: vi.fn(async () => null),
  clearPassword: vi.fn(async () => {
    localStorage.removeItem("c64u_has_password");
  }),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

const addErrorLogMock = addErrorLog as unknown as ReturnType<typeof vi.fn>;
const addLogMock = addLog as unknown as ReturnType<typeof vi.fn>;

const okJsonResponse = (body: object = { errors: [] }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// ── Tests ──────────────────────────────────────────────────────────────────
describe("c64api utility functions - targeted branch coverage", () => {
  beforeAll(() => {
    if (typeof process !== "undefined") {
      process.on("unhandledRejection", abortUnhandledRejectionHandler);
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (typeof process !== "undefined") {
      process.off("unhandledRejection", abortUnhandledRejectionHandler);
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    getFetchMock().mockReset();
    localStorage.clear();
  });

  // ── normalizeDeviceHost ──────────────────────────────────────────────────
  describe("normalizeDeviceHost", () => {
    it("fallback to DEFAULT_DEVICE_HOST when input is undefined", () => {
      const result = normalizeDeviceHost(undefined);
      expect(result).toBe("c64u");
    });

    it("fallback to DEFAULT_DEVICE_HOST when sanitized input is empty", () => {
      const result = normalizeDeviceHost("");
      expect(result).toBe("c64u");
    });

    it("triggers catch in sanitizeHostInput for malformed http URL (covers line 292)", () => {
      // 'http://' is a scheme-only URL that new URL() rejects
      const result = normalizeDeviceHost("http://");
      expect(result).toBe("c64u");
    });

    it("extracts host from valid URL input", () => {
      const result = normalizeDeviceHost("http://mydevice:8080/path");
      expect(result).toBe("mydevice:8080");
    });
  });

  // ── getDeviceHostFromBaseUrl ─────────────────────────────────────────────
  describe("getDeviceHostFromBaseUrl", () => {
    it("returns DEFAULT_DEVICE_HOST when baseUrl is undefined (line 300)", () => {
      const result = getDeviceHostFromBaseUrl(undefined);
      expect(result).toBe("c64u");
    });

    it("returns DEFAULT_DEVICE_HOST when baseUrl is empty string (line 300)", () => {
      const result = getDeviceHostFromBaseUrl("");
      expect(result).toBe("c64u");
    });

    it("triggers catch block and falls back for an invalid URL (line 307)", () => {
      const result = getDeviceHostFromBaseUrl("not a valid url!!!");
      // catch block runs then falls back — value is truthy
      expect(result).toBeTruthy();
      expect(addLogMock).toHaveBeenCalledWith(
        "warn",
        "Failed to parse device host from base URL",
        expect.objectContaining({ baseUrl: "not a valid url!!!" }),
      );
    });

    it("returns URL host for valid baseUrl", () => {
      const result = getDeviceHostFromBaseUrl("http://mydevice.local:8080");
      expect(result).toBe("mydevice.local:8080");
    });
  });

  // ── IPv6 branch in isLocalDeviceHost (lines 361-362) ────────────────────
  describe("IPv6 host detection via updateC64APIConfig (lines 361-362)", () => {
    it('handles IPv6 bracket address — covers startsWith("[") branch', () => {
      // updateC64APIConfig → resolvePreferredDeviceHost → isLocalDeviceHost('[::1]:8080')
      expect(() => updateC64APIConfig("http://[::1]:8080/")).not.toThrow();
    });

    it("handles IPv6 with port in WEB_PROXY_PATH baseUrl", () => {
      expect(() => updateC64APIConfig("http://[::1]:8080/api/rest")).not.toThrow();
    });
  });

  // ── Auth headers: password (lines 560-561) ───────────────────────────────
  describe("password header injection (lines 560-561)", () => {
    it("includes X-Password header when API is constructed with password", async () => {
      const fm = getFetchMock();
      fm.mockResolvedValue(okJsonResponse({ version: "1.0", product: "Ultimate" }));

      const api = new C64API("http://c64u", "secret123");
      await api.getInfo();

      const [, options] = fm.mock.calls[0] as [string, RequestInit];
      const headers = options?.headers as Record<string, string>;
      expect(headers["X-Password"]).toBe("secret123");
    });

    it("does NOT include X-Password header when no password set", async () => {
      const fm = getFetchMock();
      fm.mockResolvedValue(okJsonResponse({ version: "1.0", product: "Ultimate" }));

      const api = new C64API("http://c64u");
      await api.getInfo();

      const [, options] = fm.mock.calls[0] as [string, RequestInit];
      const headers = options?.headers as Record<string, string>;
      expect(headers?.["X-Password"]).toBeUndefined();
    });
  });

  // ── Proxy host header injection (lines 564-565) ──────────────────────────
  describe("proxy host header injection (lines 564-565)", () => {
    it("includes X-C64U-Host header when baseUrl contains WEB_PROXY_PATH", async () => {
      const fm = getFetchMock();
      fm.mockResolvedValue(okJsonResponse({ version: "1.0", product: "Ultimate" }));

      // Use setBaseUrl so resolvePlatformApiBaseUrl picks up the path directly
      const api = new C64API("http://c64u", undefined, "c64u");
      api.setBaseUrl("http://localhost/api/rest"); // '/api/rest' is WEB_PROXY_PATH
      await api.getInfo();

      const [, options] = fm.mock.calls[0] as [string, RequestInit];
      const headers = options?.headers as Record<string, string>;
      expect(headers["X-C64U-Host"]).toBeTruthy();
    });

    it("includes X-C64U-Host header when baseUrl is localhost (isLocalProxy)", async () => {
      const fm = getFetchMock();
      fm.mockResolvedValue(okJsonResponse({ version: "1.0", product: "Ultimate" }));

      const api = new C64API("http://c64u", undefined, "c64u");
      api.setBaseUrl("http://localhost:8080");
      await api.getInfo();

      const [, options] = fm.mock.calls[0] as [string, RequestInit];
      const headers = options?.headers as Record<string, string>;
      expect(headers["X-C64U-Host"]).toBeTruthy();
    });
  });

  // ── parseResponseJson: non-JSON response paths (lines 609-617) ───────────
  describe("parseResponseJson error paths", () => {
    it("throws malformed response error when response is non-JSON content type (line 609)", async () => {
      const fm = getFetchMock();
      fm.mockResolvedValue(
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );

      const api = new C64API("http://c64u");
      await expect(api.getInfo()).rejects.toMatchObject({
        code: "C64API_MALFORMED_JSON_RESPONSE",
      });
    });

    it("throws malformed response error when JSON parse fails (lines 613-617)", async () => {
      const fm = getFetchMock();
      // application/json content-type but body is not valid JSON
      fm.mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const api = new C64API("http://c64u");
      await expect(api.getInfo()).rejects.toMatchObject({
        code: "C64API_MALFORMED_JSON_RESPONSE",
      });
    });
  });

  // ── Request path errors ───────────────────────────────────────────────────
  describe("request error paths", () => {
    it("throws HTTP error when fetch returns non-ok status (line 851)", async () => {
      const fm = getFetchMock();
      fm.mockResolvedValue(
        new Response(JSON.stringify({ errors: ["not found"] }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        }),
      );

      const api = new C64API("http://c64u");
      await expect(api.getInfo()).rejects.toThrow("HTTP 404");
    });

    it("logs errorDetail for DNS failure (line 905)", async () => {
      const fm = getFetchMock();
      fm.mockRejectedValue(new TypeError("getaddrinfo ENOTFOUND c64u"));

      addErrorLogMock.mockClear();
      const api = new C64API("http://c64u");
      await expect(api.getInfo()).rejects.toThrow();
      expect(addErrorLogMock).toHaveBeenCalledWith(
        "C64 API request failed",
        expect.objectContaining({ errorDetail: "DNS lookup failed" }),
      );
    });

    it("skips error log for system intent requests on failure (line 880)", async () => {
      const fm = getFetchMock();
      fm.mockRejectedValue(new TypeError("getaddrinfo ENOTFOUND c64u"));

      addErrorLogMock.mockClear();
      const api = new C64API("http://c64u");
      await expect(api.getInfo({ __c64uIntent: "system" })).rejects.toThrow();
      expect(addErrorLogMock).not.toHaveBeenCalledWith("C64 API request failed", expect.anything());
    });

    it("pre-aborted signal with timeoutMs triggers early abort check (line 819)", async () => {
      const controller = new AbortController();
      controller.abort();

      const api = new C64API("http://c64u");
      // timeoutMs set + pre-aborted signal → outerSignal.aborted check (line 819) runs
      await expect(api.getInfo({ signal: controller.signal, timeoutMs: 5000 })).rejects.toMatchObject({
        name: "AbortError",
      });
    });
  });

  // ── resolveDeviceHostFromStorage legacy migration ──────────────────────
  describe("resolveDeviceHostFromStorage legacy migration", () => {
    it("migrates legacy c64u_base_url to c64u_device_host", () => {
      localStorage.setItem("c64u_base_url", "http://legacy.local");
      const result = resolveDeviceHostFromStorage();
      expect(result).toBe("legacy.local");
      expect(localStorage.getItem(DEVICE_HOST_KEY)).toBe("legacy.local");
      expect(localStorage.getItem("c64u_base_url")).toBeNull();
    });

    it("returns DEFAULT_DEVICE_HOST when localStorage is empty", () => {
      const result = resolveDeviceHostFromStorage();
      expect(result).toBe("c64u");
    });
  });

  // ── applyC64APIRuntimeConfig (line 323: explicit baseUrl branch) ─────────
  describe("applyC64APIRuntimeConfig", () => {
    it("applies explicit baseUrl without throwing (line 323 branch)", () => {
      expect(() => applyC64APIRuntimeConfig("http://c64u:8080", undefined, "c64u")).not.toThrow();
    });
  });
});
