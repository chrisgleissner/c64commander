/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredTelnetPort, getStoredTelnetPort, setStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { getSelectedSavedDevice, resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";

const SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1";
const TELNET_PORT_KEY = "c64u_telnet_port";

describe("telnetConfig", () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    localStorage.clear();
    resetSavedDevicesCacheForTests();
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

  it("falls back to the legacy Telnet port key when no saved-devices envelope exists", () => {
    localStorage.setItem(TELNET_PORT_KEY, "2323");

    expect(getStoredTelnetPort()).toBe(2323);
  });

  it("recovers the store's default when the saved-devices envelope is malformed", () => {
    localStorage.setItem(SAVED_DEVICES_STORAGE_KEY, "{");

    expect(getStoredTelnetPort()).toBe(23);
  });

  // HARD27-025: this module used to parse the saved-devices envelope itself, so an envelope
  // whose devices carry no `telnetPort` (what a renamed or added field looks like) made the
  // Telnet client use the legacy global key while the Settings screen, which reads the store,
  // showed the store's default. Both must answer with the same number.
  it("resolves the port the store resolves for an envelope with no port fields", () => {
    localStorage.setItem(
      SAVED_DEVICES_STORAGE_KEY,
      JSON.stringify({ version: 1, selectedDeviceId: "a", devices: [{ id: "a", host: "c64u" }] }),
    );
    localStorage.setItem(TELNET_PORT_KEY, "2323");

    const resolved = getStoredTelnetPort();

    expect(resolved).toBe(getSelectedSavedDevice()?.telnetPort);
    expect(resolved).toBe(23);
  });

  it("warns and leaves the store untouched when the saved-device sync throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem(SAVED_DEVICES_STORAGE_KEY, JSON.stringify({ notAnEnvelope: true }));
    const failingStorage = {
      ...originalLocalStorage,
      getItem: (key: string) => originalLocalStorage.getItem(key),
      removeItem: (key: string) => originalLocalStorage.removeItem(key),
      setItem: (key: string, value: string) => {
        if (key === SAVED_DEVICES_STORAGE_KEY) throw new Error("quota exceeded");
        originalLocalStorage.setItem(key, value);
      },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: failingStorage });

    expect(() => setStoredTelnetPort(2323)).not.toThrow();
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
