/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecureStorage } from "@/lib/native/secureStorage";

vi.mock("@/lib/native/secureStorage", () => ({
  SecureStorage: {
    setPassword: vi.fn(async () => undefined),
    getPassword: vi.fn(async () => ({ value: null })),
    clearPassword: vi.fn(async () => undefined),
  },
}));

const WEB_ENVELOPE_KEY = "c64u_password_envelope";
const HAS_PASSWORD_KEY = "c64u_has_password";

type SecureStorageModule = typeof import("@/lib/secureStorage");
type SavedDevicesModule = typeof import("@/lib/savedDevices/store");

const addAndSelectDevice = async (store: SavedDevicesModule, id: string, host: string) => {
  store.addSavedDevice({
    id,
    name: id,
    host,
    type: "C64U",
    typeSource: "INFERRED",
    httpPort: 80,
    ftpPort: 21,
    telnetPort: 23,
    lastKnownProduct: "C64U",
    lastKnownHostname: null,
    lastKnownUniqueId: null,
    hasPassword: false,
  });
  store.selectSavedDevice(id);
};

/**
 * HARD27-001: on the self-hosted web platform SecureStorage is the web server,
 * which keeps one plaintext password and uses it as the device X-Password
 * header, the FTP password and the web login password. These tests fail before
 * the fix, because the JSON envelope was sent to the server verbatim.
 */
describe("secureStorage on the web platform", () => {
  let secureStorage: SecureStorageModule;
  let savedDevices: SavedDevicesModule;

  beforeEach(async () => {
    vi.stubEnv("VITE_WEB_PLATFORM", "1");
    vi.resetModules();
    localStorage.clear();
    secureStorage = await import("@/lib/secureStorage");
    savedDevices = await import("@/lib/savedDevices/store");
    savedDevices.resetSavedDevicesCacheForTests();
    secureStorage.resetStoredPasswordCache();
    vi.mocked(SecureStorage.setPassword).mockClear();
    vi.mocked(SecureStorage.getPassword).mockClear();
    vi.mocked(SecureStorage.clearPassword).mockClear();
    vi.mocked(SecureStorage.getPassword).mockResolvedValue({ value: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the selected device's plaintext password to the server, not the envelope", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");

    await secureStorage.setPasswordForDevice("device-a", "plain-secret");

    const writes = vi.mocked(SecureStorage.setPassword).mock.calls;
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[writes.length - 1]?.[0]?.value).toBe("plain-secret");
  });

  it("keeps the multi-device envelope in localStorage", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    await secureStorage.setPasswordForDevice("device-a", "secret-a");
    await addAndSelectDevice(savedDevices, "device-b", "192.168.1.20");
    await secureStorage.setPasswordForDevice("device-b", "secret-b");

    const envelope = JSON.parse(localStorage.getItem(WEB_ENVELOPE_KEY) ?? "null") as {
      passwordsByDeviceId: Record<string, string>;
    };
    expect(envelope.passwordsByDeviceId).toEqual({ "device-a": "secret-a", "device-b": "secret-b" });
    // The server only ever holds the selected device's password.
    expect(vi.mocked(SecureStorage.setPassword).mock.calls.map((call) => call[0]?.value)).toEqual([
      "secret-a",
      "secret-b",
    ]);
  });

  it("re-sends the newly selected device's password when the device is switched", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    await secureStorage.setPasswordForDevice("device-a", "secret-a");
    await addAndSelectDevice(savedDevices, "device-b", "192.168.1.20");
    await secureStorage.setPasswordForDevice("device-b", "secret-b");
    await secureStorage.primeStoredPassword();
    vi.mocked(SecureStorage.setPassword).mockClear();

    savedDevices.selectSavedDevice("device-a");
    await vi.waitFor(() => {
      expect(vi.mocked(SecureStorage.setPassword).mock.calls.at(-1)?.[0]?.value).toBe("secret-a");
    });
  });

  it("recovers a server that still holds the pre-fix envelope and rewrites it as plaintext", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    vi.mocked(SecureStorage.getPassword).mockResolvedValue({
      value: JSON.stringify({
        version: 1,
        legacyDefaultPassword: null,
        passwordsByDeviceId: { "device-a": "secret-a" },
      }),
    });

    await secureStorage.primeStoredPassword();

    expect(await secureStorage.getPasswordForDevice("device-a")).toBe("secret-a");
    expect(vi.mocked(SecureStorage.setPassword).mock.calls.at(-1)?.[0]?.value).toBe("secret-a");
  });

  it("clears the server password when the selected device's password is removed", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    await secureStorage.setPasswordForDevice("device-a", "secret-a");
    vi.mocked(SecureStorage.clearPassword).mockClear();

    await secureStorage.clearPasswordForDevice("device-a");

    expect(vi.mocked(SecureStorage.clearPassword)).toHaveBeenCalled();
  });

  // A server upgraded from before the fix can hold a legacy single password rather than the
  // envelope. It belongs to whichever device is selected, because that is the only device the
  // server was ever able to talk to.
  it("adopts a plain server password as the selected device's", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    vi.mocked(SecureStorage.getPassword).mockResolvedValue({ value: "legacy-plain" });

    await secureStorage.primeStoredPassword();

    expect(await secureStorage.getPasswordForDevice("device-a")).toBe("legacy-plain");
  });

  it("keeps a plain server password as the default when no device is selected", async () => {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    vi.mocked(SecureStorage.getPassword).mockResolvedValue({ value: "legacy-plain" });

    await secureStorage.primeStoredPassword();

    expect(await secureStorage.getPassword()).toBe("legacy-plain");
  });

  // Storage can be unavailable in a private-browsing context. The selected device's password still
  // lives on the server, so the session keeps working and only the other devices' entries are lost.
  it("survives a localStorage that refuses to be read", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    vi.mocked(SecureStorage.getPassword).mockResolvedValue({ value: "server-secret" });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key === WEB_ENVELOPE_KEY) throw new DOMException("denied", "SecurityError");
      // The presence flag has to keep answering, or the load short-circuits before it reads
      // the envelope at all and the case under test never runs.
      return key === HAS_PASSWORD_KEY ? "1" : null;
    });

    await expect(secureStorage.primeStoredPassword()).resolves.toBeUndefined();

    getItem.mockRestore();
  });

  it("survives a localStorage that refuses to be written", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string) => {
      if (key === WEB_ENVELOPE_KEY) throw new DOMException("quota", "QuotaExceededError");
    });

    await expect(secureStorage.setPasswordForDevice("device-a", "secret-a")).resolves.toBeUndefined();

    setItem.mockRestore();
    // The password the server needs still went out, which is the half that has to survive.
    expect(vi.mocked(SecureStorage.setPassword).mock.calls.at(-1)?.[0]?.value).toBe("secret-a");
  });

  it("stores a password set with no device selected as the default", async () => {
    await secureStorage.setPassword("no-device-secret");

    expect(await secureStorage.getPassword()).toBe("no-device-secret");
    expect(vi.mocked(SecureStorage.setPassword).mock.calls.at(-1)?.[0]?.value).toBe("no-device-secret");
  });

  it("clears the server password and the envelope together", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    await secureStorage.setPasswordForDevice("device-a", "secret-a");
    vi.mocked(SecureStorage.clearPassword).mockClear();

    await secureStorage.clearPassword();

    expect(vi.mocked(SecureStorage.clearPassword)).toHaveBeenCalled();
    expect(localStorage.getItem(HAS_PASSWORD_KEY)).toBeNull();
  });

  // The re-send happens outside any caller's await, so a rejection has nowhere to go but the log.
  // It must not become an unhandled rejection, and the next explicit write has to still be tried.
  it("logs a failed re-send when the device is switched", async () => {
    await addAndSelectDevice(savedDevices, "device-a", "192.168.1.10");
    await secureStorage.setPasswordForDevice("device-a", "secret-a");
    await addAndSelectDevice(savedDevices, "device-b", "192.168.1.20");
    await secureStorage.setPasswordForDevice("device-b", "secret-b");
    await secureStorage.primeStoredPassword();
    vi.mocked(SecureStorage.setPassword).mockRejectedValueOnce(new Error("server unreachable"));

    savedDevices.selectSavedDevice("device-a");

    await vi.waitFor(() => {
      expect(vi.mocked(SecureStorage.setPassword)).toHaveBeenCalled();
    });
  });
});
