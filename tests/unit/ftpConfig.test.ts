/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  clearFtpBridgeUrl,
  clearRuntimeFtpPortOverride,
  clearStoredFtpPort,
  getFtpBridgeUrl,
  getStoredFtpPort,
  resolveFtpConnectionOptions,
  setFtpBridgeUrl,
  setRuntimeFtpPortOverride,
  setStoredFtpPort,
} from "@/lib/ftp/ftpConfig";
import { getSelectedSavedDevice, resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";

const FTP_PORT_KEY = "c64u_ftp_port";
const SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1";

const { mockGetPassword } = vi.hoisted(() => ({
  mockGetPassword: vi.fn(async () => "secret" as string | null),
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: mockGetPassword,
}));

const { mockResolveDeviceHostFromStorage, mockStripPortFromDeviceHost } = vi.hoisted(() => ({
  mockResolveDeviceHostFromStorage: vi.fn(() => "192.168.1.50:8080"),
  mockStripPortFromDeviceHost: vi.fn((host: string) => host.split(":")[0]),
}));

vi.mock("@/lib/c64api/hostConfig", () => ({
  resolveDeviceHostFromStorage: mockResolveDeviceHostFromStorage,
  stripPortFromDeviceHost: mockStripPortFromDeviceHost,
}));

describe("ftpConfig", () => {
  beforeEach(() => {
    localStorage.clear();
    clearRuntimeFtpPortOverride();
    resetSavedDevicesCacheForTests();
  });

  afterEach(() => {
    clearRuntimeFtpPortOverride();
    vi.unstubAllEnvs();
  });

  it("returns default FTP port when missing or invalid", () => {
    expect(getStoredFtpPort()).toBe(21);
    localStorage.setItem(FTP_PORT_KEY, "0");
    expect(getStoredFtpPort()).toBe(21);
    localStorage.setItem(FTP_PORT_KEY, "abc");
    expect(getStoredFtpPort()).toBe(21);
  });

  it("stores and clears FTP port", () => {
    setStoredFtpPort(2121);
    expect(getStoredFtpPort()).toBe(2121);
    clearStoredFtpPort();
    expect(getStoredFtpPort()).toBe(21);
  });

  it("ignores invalid port in setStoredFtpPort", () => {
    setStoredFtpPort(2121);
    setStoredFtpPort(0);
    expect(getStoredFtpPort()).toBe(2121);
    setStoredFtpPort(-1);
    expect(getStoredFtpPort()).toBe(2121);
    setStoredFtpPort(70000);
    expect(getStoredFtpPort()).toBe(2121);
    setStoredFtpPort(12.5);
    expect(getStoredFtpPort()).toBe(2121);
  });

  it("ignores a saved-device FTP port outside the TCP range", () => {
    localStorage.setItem(
      SAVED_DEVICES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        selectedDeviceId: "saved-device-1",
        devices: [{ id: "saved-device-1", host: "c64u", ftpPort: 70000 }],
      }),
    );

    expect(getStoredFtpPort()).toBe(21);
  });

  it("falls back to the legacy FTP port key when no saved-devices envelope exists", () => {
    localStorage.setItem(FTP_PORT_KEY, "2121");

    expect(getStoredFtpPort()).toBe(2121);
  });

  it("recovers the store's default when the saved-devices envelope is malformed", () => {
    localStorage.setItem(SAVED_DEVICES_STORAGE_KEY, "{");

    expect(getStoredFtpPort()).toBe(21);
  });

  // HARD27-025: this module used to parse the saved-devices envelope itself, so an envelope
  // whose devices carry no `ftpPort` (what a renamed or added field looks like) made the FTP
  // client connect on the legacy global port while the Settings screen, which reads the store,
  // showed the store's default. Both must answer with the same number.
  it("resolves the port the store resolves for an envelope with no port fields", () => {
    localStorage.setItem(
      SAVED_DEVICES_STORAGE_KEY,
      JSON.stringify({ version: 1, selectedDeviceId: "a", devices: [{ id: "a", host: "c64u" }] }),
    );
    localStorage.setItem(FTP_PORT_KEY, "2121");

    const resolved = getStoredFtpPort();

    expect(resolved).toBe(getSelectedSavedDevice()?.ftpPort);
    expect(resolved).toBe(21);
  });

  it("warns and leaves the store untouched when the saved-device sync throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const realStorage = globalThis.localStorage;
    const failingStorage = {
      ...realStorage,
      getItem: (key: string) => realStorage.getItem(key),
      removeItem: (key: string) => realStorage.removeItem(key),
      setItem: (key: string, value: string) => {
        if (key === SAVED_DEVICES_STORAGE_KEY) throw new Error("quota exceeded");
        realStorage.setItem(key, value);
      },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: failingStorage });

    try {
      expect(() => setStoredFtpPort(2121)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to sync FTP port to selected saved device",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: realStorage });
      warnSpy.mockRestore();
    }
  });

  it("stores and clears FTP bridge URL", () => {
    setFtpBridgeUrl("http://localhost:4000");
    expect(getFtpBridgeUrl()).toBe("http://localhost:4000");
    clearFtpBridgeUrl();
    expect(getFtpBridgeUrl()).toBe("");
  });

  it("ignores empty URL in setFtpBridgeUrl", () => {
    setFtpBridgeUrl("http://before.example.com");
    setFtpBridgeUrl("");
    expect(getFtpBridgeUrl()).toBe("http://before.example.com");
  });

  describe("runtime FTP port override", () => {
    afterEach(() => {
      clearRuntimeFtpPortOverride();
    });

    it("overrides stored port when set", () => {
      setStoredFtpPort(2121);
      setRuntimeFtpPortOverride(9021);
      expect(getStoredFtpPort()).toBe(9021);
    });

    it("restores stored port after clearing override", () => {
      setStoredFtpPort(2121);
      setRuntimeFtpPortOverride(9021);
      clearRuntimeFtpPortOverride();
      expect(getStoredFtpPort()).toBe(2121);
    });

    it("clears override when null is passed to setRuntimeFtpPortOverride", () => {
      setRuntimeFtpPortOverride(9021);
      setRuntimeFtpPortOverride(null);
      expect(getStoredFtpPort()).toBe(21);
    });

    it("ignores invalid port in setRuntimeFtpPortOverride", () => {
      setRuntimeFtpPortOverride(9021);
      setRuntimeFtpPortOverride(0);
      expect(getStoredFtpPort()).toBe(9021);
      setRuntimeFtpPortOverride(-5);
      expect(getStoredFtpPort()).toBe(9021);
    });
  });

  it("setRuntimeFtpPortOverride sets and clears override (lines 16, 33)", () => {
    setRuntimeFtpPortOverride(2121);
    expect(getStoredFtpPort()).toBe(2121); // line 16 TRUE
    setRuntimeFtpPortOverride(null); // line 33 TRUE
    expect(getStoredFtpPort()).toBe(21);
  });

  it("setRuntimeFtpPortOverride ignores invalid port (line 37)", () => {
    setRuntimeFtpPortOverride(-1);
    expect(getStoredFtpPort()).toBe(21);
    setRuntimeFtpPortOverride(0);
    expect(getStoredFtpPort()).toBe(21);
  });

  it("setStoredFtpPort ignores invalid port (line 24)", () => {
    setStoredFtpPort(-5);
    expect(getStoredFtpPort()).toBe(21);
    setStoredFtpPort(0);
    expect(getStoredFtpPort()).toBe(21);
  });

  it("setFtpBridgeUrl ignores empty string (line 56)", () => {
    setFtpBridgeUrl("");
    expect(getFtpBridgeUrl()).toBe("");
  });

  it("getFtpBridgeUrl returns /api/ftp when VITE_WEB_PLATFORM is 1 (line 48)", () => {
    vi.stubEnv("VITE_WEB_PLATFORM", "1");
    clearFtpBridgeUrl();
    expect(getFtpBridgeUrl()).toBe("/api/ftp");
  });

  describe("resolveFtpConnectionOptions (HARD18-025)", () => {
    it("resolves host/port/credentials for the currently selected device", async () => {
      setStoredFtpPort(2121);
      mockGetPassword.mockResolvedValueOnce("secret");

      const options = await resolveFtpConnectionOptions();

      expect(mockResolveDeviceHostFromStorage).toHaveBeenCalled();
      expect(mockStripPortFromDeviceHost).toHaveBeenCalledWith("192.168.1.50:8080");
      expect(options).toEqual({
        host: "192.168.1.50",
        port: 2121,
        username: "user",
        password: "secret",
      });
    });

    it("falls back to an empty password when none is stored", async () => {
      mockGetPassword.mockResolvedValueOnce(null);

      const options = await resolveFtpConnectionOptions();

      expect(options.password).toBe("");
    });
  });
});
