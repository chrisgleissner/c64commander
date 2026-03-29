import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addLogMock = vi.fn();

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

import {
  buildDeviceHostWithHttpPort,
  buildBaseUrlFromDeviceHost,
  getDeviceHostHttpPort,
  getDeviceHostFromBaseUrl,
  isLocalProxy,
  normalizeDeviceHost,
  resolveDeviceHostFromStorage,
  resolvePlatformApiBaseUrl,
  resolvePreferredDeviceHost,
  stripPortFromDeviceHost,
} from "@/lib/c64api/hostConfig";

describe("hostConfig", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    addLogMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    originalLocalStorage?.clear?.();
  });

  it("normalizes plain hosts, URL inputs, and malformed values defensively", () => {
    expect(normalizeDeviceHost(undefined)).toBe("c64u");
    expect(normalizeDeviceHost(" demo.local/path ")).toBe("demo.local");
    expect(buildBaseUrlFromDeviceHost("https://demo.local:8080/library")).toBe("http://demo.local:8080");
    expect(stripPortFromDeviceHost("demo.local:8080")).toBe("demo.local");
    expect(getDeviceHostHttpPort("demo.local:8080")).toBe(8080);
    expect(buildDeviceHostWithHttpPort("demo.local", 8080)).toBe("demo.local:8080");
    expect(buildDeviceHostWithHttpPort("demo.local", 80)).toBe("demo.local");
    expect(normalizeDeviceHost("http://[::1")).toBe("c64u");
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Failed to parse host from URL input",
      expect.objectContaining({ input: "http://[::1" }),
    );
  });

  it("reads device hosts from direct storage and migrates legacy base URLs", () => {
    localStorage.setItem("c64u_device_host", " demo-box.local ");
    localStorage.setItem("c64u_base_url", "http://legacy-box.local");
    expect(resolveDeviceHostFromStorage()).toBe("demo-box.local");
    expect(localStorage.getItem("c64u_base_url")).toBeNull();

    localStorage.clear();
    localStorage.setItem("c64u_base_url", "http://legacy-box.local:8080/rest");

    expect(resolveDeviceHostFromStorage()).toBe("legacy-box.local:8080");
    expect(localStorage.getItem("c64u_device_host")).toBe("legacy-box.local:8080");
  });

  it("falls back safely when storage or base URLs are unavailable", () => {
    // @ts-expect-error branch coverage: simulate environments without storage
    delete globalThis.localStorage;
    expect(resolveDeviceHostFromStorage()).toBe("c64u");

    expect(getDeviceHostFromBaseUrl("not-a-url/path")).toBe("not-a-url");
    expect(getDeviceHostHttpPort("demo.local", "not-a-url")).toBe(80);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Failed to parse device host from base URL",
      expect.objectContaining({ baseUrl: "not-a-url/path" }),
    );
  });

  it("resolves platform URLs and detects local proxies defensively", () => {
    expect(resolvePlatformApiBaseUrl("demo.local", "http://demo.local:8080/")).toBe("http://demo.local:8080");
    expect(resolvePlatformApiBaseUrl("demo.local")).toBe("http://demo.local");

    expect(isLocalProxy("http://127.0.0.1:8787")).toBe(true);
    expect(isLocalProxy("http://localhost:8787")).toBe(true);
    expect(isLocalProxy("not-a-url")).toBe(false);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Failed to parse base URL for proxy detection",
      expect.objectContaining({ baseUrl: "not-a-url" }),
    );
  });

  it("prefers stored hosts when the base URL is only a fallback hostname", () => {
    localStorage.setItem("c64u_device_host", "stored-box.local");
    expect(resolvePreferredDeviceHost("http://c64u")).toBe("stored-box.local");
    expect(addLogMock).toHaveBeenCalledWith(
      "info",
      "Using stored device host instead of default hostname",
      expect.objectContaining({ storedHost: "stored-box.local" }),
    );
  });

  it("ignores localhost fallback origins in favor of a stored remote host", () => {
    localStorage.setItem("c64u_device_host", "stored-box.local");
    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          origin: "http://localhost:4173",
        },
      },
      configurable: true,
      writable: true,
    });

    expect(resolvePreferredDeviceHost("http://localhost:4173/")).toBe("stored-box.local");
    expect(resolvePreferredDeviceHost("http://localhost:4173/api/rest/info")).toBe("stored-box.local");
    expect(resolvePreferredDeviceHost("http://localhost:4173", "explicit-box.local")).toBe("explicit-box.local");
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Ignoring localhost base URL in favor of stored host",
      expect.objectContaining({ storedHost: "stored-box.local" }),
    );
  });
});
