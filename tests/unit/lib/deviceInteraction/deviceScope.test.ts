/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deviceScopeOfHost,
  registerSavedDevicesForDeviceScope,
  resolveRestDeviceScope,
} from "@/lib/deviceInteraction/deviceScope";
import type { SavedDevice, SavedDevicesSnapshot } from "@/lib/savedDevices/store";

const savedDevice = (id: string, host: string, uniqueId: string | null, hostname: string | null) =>
  ({ id, host, lastKnownUniqueId: uniqueId, lastKnownHostname: hostname }) as SavedDevice;

const snapshotOf = (
  devices: SavedDevice[],
  verifiedByDeviceId: SavedDevicesSnapshot["verifiedByDeviceId"] = {},
): Pick<SavedDevicesSnapshot, "devices" | "verifiedByDeviceId"> => ({ devices, verifiedByDeviceId });

describe("deviceScopeOfHost", () => {
  afterEach(() => registerSavedDevicesForDeviceScope(null));

  it.each([
    ["c64u", "c64u"],
    ["C64U:8080", "c64u"],
    ["192.168.1.13", "192.168.1.13"],
    ["[fe80::1]:8080", "fe80::1"],
    ["[FE80::1]", "fe80::1"],
    ["fe80::1", "fe80::1"],
    ["  c64u  ", "c64u"],
  ])("scopes %s to %s", (host, expected) => {
    expect(deviceScopeOfHost(host)).toBe(expected);
  });

  it("gives both addresses of one saved Ultimate the same scope", () => {
    const snapshot = snapshotOf([
      savedDevice("ethernet", "192.168.1.13", "8D927F", "c64u-8d927f"),
      savedDevice("wifi", "192.168.1.48", "8D927F", "c64u-8d927f"),
    ]);
    registerSavedDevicesForDeviceScope(() => snapshot);

    expect(deviceScopeOfHost("192.168.1.48:80")).toBe(deviceScopeOfHost("192.168.1.13"));
    expect(deviceScopeOfHost("192.168.1.13")).not.toBe("192.168.1.13");
  });

  it("uses the identity the entry last verified", () => {
    const snapshot = snapshotOf(
      [savedDevice("ethernet", "192.168.1.13", null, null), savedDevice("wifi", "192.168.1.48", null, null)],
      {
        ethernet: { uniqueId: "8D927F", hostname: "c64u-8d927f" },
        wifi: { uniqueId: "8D927F", hostname: "c64u-8d927f" },
      } as SavedDevicesSnapshot["verifiedByDeviceId"],
    );
    registerSavedDevicesForDeviceScope(() => snapshot);

    expect(deviceScopeOfHost("192.168.1.48")).toBe(deviceScopeOfHost("192.168.1.13"));
  });

  it("keeps hosts of unknown identity, and different machines, in their own scopes", () => {
    const snapshot = snapshotOf([
      savedDevice("c64u", "c64u", "8D927F", "c64u-8d927f"),
      savedDevice("u64", "u64", "11AA22", "u64-11aa22"),
      savedDevice("unknown-a", "10.0.0.5", null, "c64u-8d927f"),
      savedDevice("unknown-b", "10.0.0.6", null, null),
    ]);
    registerSavedDevicesForDeviceScope(() => snapshot);

    const scopes = ["c64u", "u64", "10.0.0.5", "10.0.0.6", "not-saved"].map(deviceScopeOfHost);
    expect(new Set(scopes).size).toBe(5);
    expect(scopes.slice(2)).toEqual(["10.0.0.5", "10.0.0.6", "not-saved"]);
  });
});

describe("resolveRestDeviceScope", () => {
  it.each([
    [{ baseUrl: "http://c64u" }, "c64u"],
    [{ baseUrl: "http://C64U:8080/" }, "c64u"],
    [{ baseUrl: "http://[fe80::1]:8080" }, "fe80::1"],
    [{ baseUrl: "http://localhost:8064/api/rest", deviceHost: "u2:8080" }, "u2"],
    [{ baseUrl: "http://localhost:8064/api/rest", deviceHost: "fe80::1" }, "fe80::1"],
    [{ baseUrl: "http://c64u", deviceHost: "  " }, "c64u"],
  ])("scopes %o to %s", (target, expected) => {
    expect(resolveRestDeviceScope(target)).toBe(expected);
  });
});

describe("deviceScopeOfHost with the saved-devices store", () => {
  it("shares one scope between two saved addresses of one Ultimate once the store is loaded", async () => {
    vi.resetModules();
    const entry = (id: string, host: string) => ({
      id,
      name: id,
      nameSource: "custom",
      host,
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "c64u-8d927f",
      lastKnownUniqueId: "8D927F",
      lastSuccessfulConnectionAt: null,
      lastUsedAt: null,
      hasPassword: false,
    });
    localStorage.setItem(
      "c64u_saved_devices:v1",
      JSON.stringify({
        version: 1,
        selectedDeviceId: "ethernet",
        devices: [entry("ethernet", "192.168.1.13"), entry("wifi", "192.168.1.48")],
        summaries: {},
        summaryLru: [],
        hasEverHadMultipleDevices: true,
      }),
    );
    try {
      await import("@/lib/savedDevices/store");
      const scope = await import("@/lib/deviceInteraction/deviceScope");
      expect(scope.deviceScopeOfHost("192.168.1.48")).toBe(scope.deviceScopeOfHost("192.168.1.13"));
    } finally {
      localStorage.removeItem("c64u_saved_devices:v1");
    }
  });
});
