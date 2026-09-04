/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/authChallenge", () => ({
  notifyAuthRequired: vi.fn(),
  notifyAuthSatisfied: vi.fn(),
}));

vi.mock("@/lib/secureStorage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/secureStorage")>("@/lib/secureStorage");
  return { ...actual, getPasswordForDevice: vi.fn(async () => null) };
});

import { notifyAuthRequired } from "@/lib/auth/authChallenge";
import { getPasswordForDevice } from "@/lib/secureStorage";
import { getSavedDevicesStorageKey, resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";
import { resolveForeignSenderPassword, stopStreamAtForeignHost } from "@/lib/streams/foreignSenderStop";

/**
 * HARD27-019. The eviction addresses the OTHER Ultimate on the LAN. Sent unauthenticated it is
 * refused with 403, and the refusal used to open the app-wide password dialog naming a machine the
 * user never selected.
 */

const FOREIGN_IP = "192.168.1.15";

const saveDevices = (devices: unknown[], summaries: Record<string, unknown> = {}) => {
  localStorage.setItem(
    getSavedDevicesStorageKey(),
    JSON.stringify({ selectedDeviceId: "sel", devices, summaries, runtimeStatuses: {} }),
  );
  resetSavedDevicesCacheForTests();
};

const device = (over: Record<string, unknown>) => ({
  id: "other",
  name: "Other",
  host: FOREIGN_IP,
  httpPort: 80,
  ftpPort: 21,
  telnetPort: 23,
  lastKnownProduct: null,
  lastKnownHostname: null,
  lastKnownUniqueId: null,
  lastSuccessfulConnectionAt: null,
  lastUsedAt: null,
  hasPassword: false,
  ...over,
});

describe("foreign-sender eviction credentials (HARD27-019)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    resetSavedDevicesCacheForTests();
    vi.mocked(notifyAuthRequired).mockClear();
    vi.mocked(getPasswordForDevice).mockReset().mockResolvedValue(null);
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ errors: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    resetSavedDevicesCacheForTests();
  });

  it("never raises the network-password dialog when the other Ultimate refuses the stop", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: ["forbidden"] }), { status: 403, statusText: "Forbidden" }),
    );

    await expect(stopStreamAtForeignHost(FOREIGN_IP, "audio")).rejects.toBeDefined();

    expect(fetchMock).toHaveBeenCalled();
    expect(notifyAuthRequired).not.toHaveBeenCalled();
  });

  it("sends the saved-device password for a foreign sender saved by address", async () => {
    saveDevices([device({ hasPassword: true })]);
    vi.mocked(getPasswordForDevice).mockResolvedValue("redacted-password");

    await stopStreamAtForeignHost(`${FOREIGN_IP}:80`, "audio");

    expect(getPasswordForDevice).toHaveBeenCalledWith("other");
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers ?? {};
    expect(headers["X-Password"]).toBe("redacted-password");
  });

  it("matches a foreign sender against the address a hostname-saved device last resolved to", async () => {
    saveDevices([device({ host: "u64", hasPassword: true })], {
      other: { deviceId: "other", lastResolvedAddress: FOREIGN_IP },
    });
    vi.mocked(getPasswordForDevice).mockResolvedValue("redacted-password");

    await expect(resolveForeignSenderPassword(FOREIGN_IP)).resolves.toBe("redacted-password");
  });

  it("sends no password when the foreign sender is not a saved device", async () => {
    saveDevices([device({ id: "sel", host: "10.0.0.9", hasPassword: true })]);

    await expect(resolveForeignSenderPassword(FOREIGN_IP)).resolves.toBeNull();
    expect(getPasswordForDevice).not.toHaveBeenCalled();
  });

  it("sends no password for a saved device that has none", async () => {
    saveDevices([device({ hasPassword: false })]);

    await expect(resolveForeignSenderPassword(FOREIGN_IP)).resolves.toBeNull();
    expect(getPasswordForDevice).not.toHaveBeenCalled();
  });

  it("sends no password for an empty host", async () => {
    await expect(resolveForeignSenderPassword("   ")).resolves.toBeNull();
  });

  // The lookup is a convenience on the way to an eviction that has to happen either way, so a
  // store that cannot be read costs the authentication rather than the stop.
  it("falls back to no password when the saved-device lookup throws", async () => {
    saveDevices([device({ hasPassword: true })]);
    vi.mocked(getPasswordForDevice).mockRejectedValue(new Error("keystore unavailable"));

    await expect(resolveForeignSenderPassword(FOREIGN_IP)).resolves.toBeNull();
  });
});
