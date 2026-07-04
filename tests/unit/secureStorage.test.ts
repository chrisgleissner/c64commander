/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPassword,
  getCachedPassword,
  getPassword,
  getPasswordForDevice,
  migrateLegacyDefaultPassword,
  primeStoredPassword,
  resetStoredPasswordCache,
  setPassword,
} from "@/lib/secureStorage";
import { SecureStorage } from "@/lib/native/secureStorage";
import { addSavedDevice, getSavedDevicesSnapshot, selectSavedDevice } from "@/lib/savedDevices/store";

const HAS_PASSWORD_KEY = "c64u_has_password";

vi.mock("@/lib/native/secureStorage", () => ({
  SecureStorage: {
    setPassword: vi.fn(async () => undefined),
    getPassword: vi.fn(async () => ({ value: null })),
    clearPassword: vi.fn(async () => undefined),
  },
}));

describe("secureStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStoredPasswordCache();
    vi.mocked(SecureStorage.setPassword).mockClear();
    vi.mocked(SecureStorage.getPassword).mockClear();
    vi.mocked(SecureStorage.clearPassword).mockClear();
  });

  it("never writes password to localStorage when setting", async () => {
    await setPassword("super-secret");

    const persisted = JSON.parse(vi.mocked(SecureStorage.setPassword).mock.calls[0]?.[0]?.value ?? "null") as {
      version: number;
      legacyDefaultPassword: string | null;
      passwordsByDeviceId: Record<string, string>;
    };
    const selectedDeviceId = getSavedDevicesSnapshot().selectedDeviceId;

    expect(localStorage.getItem("c64u_password")).toBeNull();
    expect(localStorage.getItem(HAS_PASSWORD_KEY)).toBe("1");
    expect(persisted.version).toBe(1);
    expect(persisted.legacyDefaultPassword).toBeNull();
    expect(persisted.passwordsByDeviceId[selectedDeviceId]).toBe("super-secret");
  });

  it("does not touch secure storage when flag is false", async () => {
    localStorage.removeItem(HAS_PASSWORD_KEY);

    const value = await getPassword();

    expect(value).toBeNull();
    expect(SecureStorage.getPassword).not.toHaveBeenCalled();
  });

  it("does not read legacy localStorage for regular lookups", async () => {
    const getItemSpy = vi.spyOn(localStorage, "getItem");
    localStorage.setItem("c64u_password", "legacy-secret");
    localStorage.setItem(HAS_PASSWORD_KEY, "1");

    vi.mocked(SecureStorage.getPassword).mockResolvedValueOnce({
      value: "secure-secret",
    });

    const value = await getPassword();

    expect(value).toBe("secure-secret");
    expect(getItemSpy).not.toHaveBeenCalledWith("c64u_password");
  });

  it("clears password and removes presence flag", async () => {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");

    await clearPassword();

    expect(localStorage.getItem(HAS_PASSWORD_KEY)).toBeNull();
    expect(SecureStorage.clearPassword).toHaveBeenCalled();
  });

  it("getCachedPassword returns the password value once loaded", async () => {
    // Covers the passwordLoaded ? cachedPassword : null true branch (line 32)
    await setPassword("my-secret");
    expect(getCachedPassword()).toBe("my-secret");
  });

  it("returns cached password on second call without re-fetching from native storage", async () => {
    // Covers the if (passwordLoaded) return cachedPassword branch (line 45)
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    vi.mocked(SecureStorage.getPassword).mockResolvedValueOnce({
      value: "cached-pw",
    });

    const first = await getPassword();
    const second = await getPassword();

    expect(first).toBe("cached-pw");
    expect(second).toBe("cached-pw");
    expect(SecureStorage.getPassword).toHaveBeenCalledOnce();
  });

  it("returns null when native secure storage has no password value", async () => {
    // Covers value ?? null when SecureStorage.getPassword returns { value: null }
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    // Default mock returns { value: null }
    const value = await getPassword();
    expect(value).toBeNull();
    expect(SecureStorage.getPassword).toHaveBeenCalledOnce();
  });

  // HARD12-012: getPasswordForDevice must NOT silently migrate the legacy
  // password into the requested device's entry. The old behaviour copied
  // device A's secret into B's entry on first read, transmitting A's password
  // to host B.
  it("does not silently migrate the legacy password into the requested device's entry", async () => {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    addSavedDevice({
      id: "device-b",
      name: "B",
      host: "192.168.1.20",
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
    vi.mocked(SecureStorage.getPassword).mockResolvedValueOnce({
      value: JSON.stringify({
        version: 1,
        legacyDefaultPassword: "device-a-secret",
        passwordsByDeviceId: {},
      }),
    });

    const resolved = await getPasswordForDevice("device-b");

    // Critical assertion: the legacy password must never be returned for a
    // device that has no entry of its own — that would transmit device A's
    // secret to device B's host.
    expect(resolved).toBeNull();
    // ...and it must not flip device B's hasPassword flag based on A's secret.
    expect(getSavedDevicesSnapshot().devices.find((device) => device.id === "device-b")?.hasPassword).toBe(false);
    // No migration write happened either.
    const writeCalls = vi.mocked(SecureStorage.setPassword).mock.calls;
    expect(writeCalls.length).toBe(0);
  });

  // HARD12-012: a once-only migration moves the legacy default password into
  // the currently-selected device's entry on first secure-storage load and
  // clears the legacy field. The original device keeps its password; the
  // legacy field cannot recur.
  it("migrateLegacyDefaultPassword moves the legacy password into the selected device once and clears it", async () => {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    addSavedDevice({
      id: "device-a",
      name: "A",
      host: "192.168.1.10",
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
    selectSavedDevice("device-a");
    vi.mocked(SecureStorage.getPassword).mockResolvedValueOnce({
      value: JSON.stringify({
        version: 1,
        legacyDefaultPassword: "device-a-secret",
        passwordsByDeviceId: {},
      }),
    });

    await migrateLegacyDefaultPassword();

    const persisted = JSON.parse(vi.mocked(SecureStorage.setPassword).mock.calls[0]?.[0]?.value ?? "null") as {
      legacyDefaultPassword: string | null;
      passwordsByDeviceId: Record<string, string>;
    };
    expect(persisted.legacyDefaultPassword).toBeNull();
    expect(persisted.passwordsByDeviceId["device-a"]).toBe("device-a-secret");

    // Second invocation is idempotent: nothing else to migrate.
    vi.mocked(SecureStorage.setPassword).mockClear();
    await migrateLegacyDefaultPassword();
    expect(vi.mocked(SecureStorage.setPassword)).not.toHaveBeenCalled();
  });

  // HARD12-012: the once-only migration must not clobber a device that
  // already has its own password entry. The legacy field is discarded in
  // that case so the cross-device bleed cannot recur.
  it("migrateLegacyDefaultPassword drops the legacy password when the selected device already has its own entry", async () => {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    addSavedDevice({
      id: "device-a",
      name: "A",
      host: "192.168.1.10",
      type: "C64U",
      typeSource: "INFERRED",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: true,
    });
    selectSavedDevice("device-a");
    vi.mocked(SecureStorage.getPassword).mockResolvedValueOnce({
      value: JSON.stringify({
        version: 1,
        legacyDefaultPassword: "STALE-LEGACY",
        passwordsByDeviceId: { "device-a": "device-a-real-secret" },
      }),
    });

    await migrateLegacyDefaultPassword();

    const persisted = JSON.parse(vi.mocked(SecureStorage.setPassword).mock.calls[0]?.[0]?.value ?? "null") as {
      legacyDefaultPassword: string | null;
      passwordsByDeviceId: Record<string, string>;
    };
    expect(persisted.legacyDefaultPassword).toBeNull();
    expect(persisted.passwordsByDeviceId["device-a"]).toBe("device-a-real-secret");
  });

  // HARD12-012: primeStoredPassword (the secure-storage bootstrap entry point)
  // runs the migration. Without this wiring the migration would never fire.
  it("primeStoredPassword runs the legacy migration on first load", async () => {
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
    addSavedDevice({
      id: "device-a",
      name: "A",
      host: "192.168.1.10",
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
    selectSavedDevice("device-a");
    vi.mocked(SecureStorage.getPassword).mockResolvedValueOnce({
      value: JSON.stringify({
        version: 1,
        legacyDefaultPassword: "device-a-secret",
        passwordsByDeviceId: {},
      }),
    });

    await primeStoredPassword();

    const writeCalls = vi.mocked(SecureStorage.setPassword).mock.calls;
    expect(writeCalls.length).toBeGreaterThanOrEqual(1);
    const persisted = JSON.parse(writeCalls[0]?.[0]?.value ?? "null") as {
      legacyDefaultPassword: string | null;
      passwordsByDeviceId: Record<string, string>;
    };
    expect(persisted.legacyDefaultPassword).toBeNull();
    expect(persisted.passwordsByDeviceId["device-a"]).toBe("device-a-secret");
  });
});
