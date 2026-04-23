/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredTelnetPort, getStoredTelnetPort, setStoredTelnetPort } from "@/lib/telnet/telnetConfig";

const SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1";
const TELNET_PORT_KEY = "c64u_telnet_port";

const { mockUpdateSelectedSavedDevicePorts } = vi.hoisted(() => ({
  mockUpdateSelectedSavedDevicePorts: vi.fn(),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  updateSelectedSavedDevicePorts: mockUpdateSelectedSavedDevicePorts,
}));

describe("telnetConfig", () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    localStorage.clear();
    mockUpdateSelectedSavedDevicePorts.mockReset();
    mockUpdateSelectedSavedDevicePorts.mockImplementation(() => undefined);
  });

  it("returns the default Telnet port when missing or invalid", () => {
    expect(getStoredTelnetPort()).toBe(23);
    localStorage.setItem(TELNET_PORT_KEY, "0");
    expect(getStoredTelnetPort()).toBe(23);
    localStorage.setItem(TELNET_PORT_KEY, "abc");
    expect(getStoredTelnetPort()).toBe(23);
  });

  it("stores and clears the Telnet port", () => {
    setStoredTelnetPort(2323);
    expect(getStoredTelnetPort()).toBe(2323);
    clearStoredTelnetPort();
    expect(getStoredTelnetPort()).toBe(23);
  });

  it("ignores invalid values in setStoredTelnetPort", () => {
    setStoredTelnetPort(2323);
    setStoredTelnetPort(0);
    expect(getStoredTelnetPort()).toBe(2323);
  });

  it("rejects non-integer and out-of-range Telnet ports", () => {
    localStorage.setItem(TELNET_PORT_KEY, "70000");
    expect(getStoredTelnetPort()).toBe(23);

    localStorage.setItem(TELNET_PORT_KEY, "12.5");
    expect(getStoredTelnetPort()).toBe(23);

    setStoredTelnetPort(2323);
    setStoredTelnetPort(70000);
    setStoredTelnetPort(12.5);
    expect(getStoredTelnetPort()).toBe(2323);
  });

  it("warns and falls back when saved-device Telnet storage is malformed", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem(SAVED_DEVICES_STORAGE_KEY, "{");
    localStorage.setItem(TELNET_PORT_KEY, "2323");

    expect(getStoredTelnetPort()).toBe(2323);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to parse saved devices while resolving Telnet port",
      expect.objectContaining({ error: expect.any(SyntaxError) }),
    );

    warnSpy.mockRestore();
  });

  it("warns and applies the manual fallback when saved-device Telnet sync fails", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockUpdateSelectedSavedDevicePorts.mockImplementationOnce(() => {
      throw new Error("sync failed");
    });
    localStorage.setItem(
      SAVED_DEVICES_STORAGE_KEY,
      JSON.stringify({
        selectedDeviceId: "saved-device-1",
        devices: [{ id: "saved-device-1", telnetPort: 23 }],
      }),
    );

    setStoredTelnetPort(2323);

    expect(JSON.parse(localStorage.getItem(SAVED_DEVICES_STORAGE_KEY) ?? "{}").devices[0].telnetPort).toBe(2323);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to sync Telnet port to selected saved device",
      expect.objectContaining({ error: expect.any(Error) }),
    );

    warnSpy.mockRestore();
  });

  it("returns defaults and no-ops when localStorage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: undefined,
    });

    expect(getStoredTelnetPort()).toBe(23);
    expect(() => setStoredTelnetPort(2323)).not.toThrow();
    expect(() => clearStoredTelnetPort()).not.toThrow();
  });
});
