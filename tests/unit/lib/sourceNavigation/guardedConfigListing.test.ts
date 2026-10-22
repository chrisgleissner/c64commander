/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { networkOffline, simulatedDevice } = vi.hoisted(() => ({
  networkOffline: vi.fn(() => false),
  simulatedDevice: vi.fn(() => false),
}));

vi.mock("@/lib/connection/networkStatusWatch", () => ({ isNetworkKnownOffline: networkOffline }));
vi.mock("@/lib/connection/connectionManager", () => ({ isSimulatedDeviceTarget: simulatedDevice }));
vi.mock("@/lib/ftp/ftpClient", async (importOriginal) => ({
  isRefusedFtpListing: (await importOriginal<typeof import("@/lib/ftp/ftpClient")>()).isRefusedFtpListing,
  listFtpDirectory: vi.fn(),
  listFtpDirectoryRecursive: vi.fn(),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: vi.fn(() => 21) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@/lib/c64api", () => ({
  getC64APIConfigSnapshot: vi.fn(() => ({ deviceHost: "u64", password: "" })),
}));

import { listFtpDirectory } from "@/lib/ftp/ftpClient";
import { createConfigListing } from "@/lib/sourceNavigation/guardedConfigListing";
import { createUltimateSourceLocation } from "@/lib/sourceNavigation/ftpSourceAdapter";

const entry = { type: "file", name: "a.cfg", path: "/USB2/Games/a.cfg" } as const;

describe("createConfigListing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(listFtpDirectory).mockReset();
    networkOffline.mockReturnValue(false);
    simulatedDevice.mockReturnValue(false);
  });

  it("answers from the listing cache and does not ask the device while the phone is offline", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    await source.listEntries("/USB2/Games");
    vi.mocked(listFtpDirectory).mockClear();
    networkOffline.mockReturnValue(true);
    const listing = createConfigListing(source);

    await expect(listing.listEntries("/USB2/Games")).resolves.toEqual([expect.objectContaining({ name: "a.cfg" })]);
    await expect(listing.listEntries("/USB2/Other")).resolves.toEqual([]);

    expect(listFtpDirectory).not.toHaveBeenCalled();
    expect(listing.skippedLookups()).toBe(2);
  });

  it("stops asking the device after one connection failure while mobile data keeps the phone online", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValue(new Error("failed to connect to /192.168.1.13 (port 21)"));
    const listing = createConfigListing(source);

    await expect(listing.listEntries("/USB2/One")).rejects.toThrow("failed to connect");
    await expect(listing.listEntries("/USB2/Two")).resolves.toEqual([]);
    await expect(listing.listEntries("/USB2/Three")).resolves.toEqual([]);

    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
    expect(listing.skippedLookups()).toBe(2);
  });

  it("keeps asking after a failure that is not about the connection", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("550 No such directory"));
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    const listing = createConfigListing(source);

    await expect(listing.listEntries("/USB2/One")).rejects.toThrow("550");
    await expect(listing.listEntries("/USB2/Two")).resolves.toHaveLength(1);
  });

  it("lists as usual when the target is a simulated device, whatever the radios say", async () => {
    simulatedDevice.mockReturnValue(true);
    networkOffline.mockReturnValue(true);
    vi.mocked(listFtpDirectory).mockResolvedValue({ entries: [entry] } as never);
    const listing = createConfigListing(createUltimateSourceLocation());

    await expect(listing.listEntries("/USB2/Games")).resolves.toHaveLength(1);
    expect(listing.skippedLookups()).toBe(0);
  });

  it("never skips a source that is not on the device", async () => {
    networkOffline.mockReturnValue(true);
    const listEntries = vi.fn(async () => []);
    const listing = createConfigListing({ type: "local", listEntries });

    await listing.listEntries("/music");

    expect(listEntries).toHaveBeenCalledTimes(1);
  });
});
