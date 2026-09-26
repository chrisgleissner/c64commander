/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceDiscoveryCandidate } from "@/lib/deviceDiscovery/types";

// A password-protected Ultimate answers /v1/info only with the password; each host maps to its answer.
const infoByHost = vi.hoisted(() => new Map<string, { product: string; hostname: string; unique_id: string }>());
const requestedHosts = vi.hoisted(() => [] as Array<{ host: string; password: string | undefined }>);

vi.mock("@/lib/c64api", () => ({
  C64API: class {
    constructor(
      _baseUrl: string,
      private readonly password: string | undefined,
      private readonly deviceHost: string,
    ) {}
    async getInfo() {
      requestedHosts.push({ host: this.deviceHost, password: this.password });
      const info = infoByHost.get(this.deviceHost);
      if (!info) throw new Error(`Host unreachable: ${this.deviceHost}`);
      return info;
    }
  },
}));

vi.mock("@/lib/native/deviceDiscovery", () => ({ DeviceDiscovery: { discover: vi.fn() } }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), buildErrorLogDetails: vi.fn() }));

// One protected Ultimate on Ethernet (192.0.2.0/24) and Wi-Fi (198.51.100.0/24).
const ETHERNET = "192.0.2.10";
const WIFI = "198.51.100.20";
const DUAL = { product: "Ultimate 64 Elite", hostname: "ultimate", unique_id: "DUAL01" };

const protectedCandidate = (address: string): DeviceDiscoveryCandidate => ({
  id: `address:${address}`,
  address,
  host: null,
  httpPort: 80,
  source: ["lan-scan"],
  product: "C64 Ultimate",
  firmwareVersion: null,
  fpgaVersion: null,
  coreVersion: null,
  hostname: null,
  uniqueId: null,
  requiresPassword: true,
  addresses: [address],
  alreadySavedDeviceId: null,
  confidence: "verified",
  lastSeenAt: "2026-09-26T00:00:00.000Z",
});

const savedEntries = async () => (await import("@/lib/savedDevices/store")).getSavedDevicesSnapshot().devices;

describe("saving a password-protected device found at two addresses", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    infoByHost.clear();
    requestedHosts.length = 0;
    infoByHost.set(ETHERNET, DUAL);
    infoByHost.set(WIFI, DUAL);
  });

  it("does not create a second saved entry when the device's other address is saved with the password", async () => {
    const { persistDiscoveredDevice, resolveDiscoveredCandidateIdentity } =
      await import("@/lib/deviceDiscovery/discoveryManager");
    const first = persistDiscoveredDevice(
      await resolveDiscoveredCandidateIdentity(protectedCandidate(ETHERNET), "pw"),
      {
        passwordPresent: true,
      },
    );
    const countAfterFirst = (await savedEntries()).length;

    const second = persistDiscoveredDevice(await resolveDiscoveredCandidateIdentity(protectedCandidate(WIFI), "pw"), {
      passwordPresent: true,
    });

    expect(second.deviceId).toBe(first.deviceId);
    expect(await savedEntries()).toHaveLength(countAfterFirst);
    expect((await savedEntries()).filter((device) => device.lastKnownUniqueId === "DUAL01")).toHaveLength(1);
  });

  it("keeps the saved address when it still answers with the same id", async () => {
    const { persistDiscoveredDevice, resolveDiscoveredCandidateIdentity } =
      await import("@/lib/deviceDiscovery/discoveryManager");
    persistDiscoveredDevice(await resolveDiscoveredCandidateIdentity(protectedCandidate(ETHERNET), "pw"), {
      passwordPresent: true,
    });

    const identified = await resolveDiscoveredCandidateIdentity(protectedCandidate(WIFI), "pw");
    const persisted = persistDiscoveredDevice(identified, { passwordPresent: true });

    expect(identified.addresses).toEqual([WIFI, ETHERNET]);
    expect(persisted.host).toBe(ETHERNET);
    expect(requestedHosts.every((request) => request.password === "pw")).toBe(true);
  });

  it("leaves the candidate unchanged without a password or when the device does not answer", async () => {
    const { resolveDiscoveredCandidateIdentity } = await import("@/lib/deviceDiscovery/discoveryManager");
    const candidate = protectedCandidate(WIFI);

    await expect(resolveDiscoveredCandidateIdentity(candidate, undefined)).resolves.toBe(candidate);
    infoByHost.delete(WIFI);
    await expect(resolveDiscoveredCandidateIdentity(candidate, "pw")).resolves.toBe(candidate);
  });
});
