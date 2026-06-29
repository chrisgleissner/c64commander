/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceInfo } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import type { TelnetCapabilitySnapshot } from "@/lib/telnet/telnetCapabilityDiscovery";
import { TELNET_ACTION_IDS } from "@/lib/telnet/telnetTypes";
import {
  clearTelnetCapabilityCache,
  getCachedTelnetCapabilities,
  rememberTelnetCapabilities,
} from "@/lib/telnet/telnetCapabilityCache";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

const STORAGE_PREFIX = "c64u:telnetCapability:";

const buildDeviceInfo = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
  product: "Ultimate 64 Elite",
  firmware_version: "3.14e",
  hostname: "u64",
  unique_id: "u64-1",
  ...overrides,
});

const buildSnapshot = (cacheKey: string): TelnetCapabilitySnapshot => ({
  cacheKey,
  deviceIdentity: "u64-1|u64|Ultimate 64 Elite|3.14e",
  menuKey: "F5",
  initialMenu: {
    items: ["C64 Machine", "Configuration"],
    defaultItem: "C64 Machine",
    nodes: {
      "C64 Machine": {
        kind: "submenu",
        items: ["Reset C64", "Reboot C64"],
        defaultItem: "Reset C64",
      },
    },
  },
  actionSupport: Object.fromEntries(
    TELNET_ACTION_IDS.map((actionId) => [
      actionId,
      {
        actionId,
        status: (actionId === "resetC64" || actionId === "rebootC64" ? "supported" : "unsupported") as
          "supported" | "unsupported",
        reason: actionId === "powerCycle" ? "Power Cycle is not available on Ultimate 64 Elite 3.14e." : "Unsupported",
        target:
          actionId === "resetC64"
            ? {
                categoryLabel: "C64 Machine",
                actionLabel: "Reset C64",
                source: "initial" as const,
              }
            : actionId === "rebootC64"
              ? {
                  categoryLabel: "C64 Machine",
                  actionLabel: "Reboot C64",
                  source: "initial" as const,
                }
              : null,
      },
    ]),
  ) as TelnetCapabilitySnapshot["actionSupport"],
});

describe("telnetCapabilityCache", () => {
  beforeEach(() => {
    localStorage.clear();
    clearTelnetCapabilityCache();
    vi.mocked(addLog).mockReset();
  });

  it("writes snapshots to localStorage and reads them back via the cache API", () => {
    const deviceInfo = buildDeviceInfo();
    const snapshot = buildSnapshot("u64-1|u64|Ultimate 64 Elite|3.14e|F5");

    rememberTelnetCapabilities(snapshot, deviceInfo);

    expect(localStorage.getItem(`${STORAGE_PREFIX}${snapshot.cacheKey}`)).toContain(snapshot.cacheKey);
    expect(getCachedTelnetCapabilities(snapshot.cacheKey, deviceInfo)).toEqual(snapshot);
  });

  it("hydrates from persisted storage when memory is empty", () => {
    const deviceInfo = buildDeviceInfo();
    const snapshot = buildSnapshot("u64-1|u64|Ultimate 64 Elite|3.14e|F5");
    localStorage.setItem(
      `${STORAGE_PREFIX}${snapshot.cacheKey}`,
      JSON.stringify({
        snapshot,
        uniqueId: deviceInfo.unique_id,
        firmwareVersion: deviceInfo.firmware_version,
      }),
    );

    expect(getCachedTelnetCapabilities(snapshot.cacheKey, deviceInfo)).toEqual(snapshot);
  });

  it("invalidates older firmware entries for the same unique id", () => {
    const oldDeviceInfo = buildDeviceInfo({ firmware_version: "3.14d" });
    const nextDeviceInfo = buildDeviceInfo({ firmware_version: "3.14e" });
    const oldSnapshot = buildSnapshot("u64-1|u64|Ultimate 64 Elite|3.14d|F5");
    const nextSnapshot = buildSnapshot("u64-1|u64|Ultimate 64 Elite|3.14e|F5");

    rememberTelnetCapabilities(oldSnapshot, oldDeviceInfo);
    rememberTelnetCapabilities(nextSnapshot, nextDeviceInfo);

    expect(localStorage.getItem(`${STORAGE_PREFIX}${oldSnapshot.cacheKey}`)).toBeNull();
    expect(getCachedTelnetCapabilities(oldSnapshot.cacheKey, nextDeviceInfo)).toBeNull();
    expect(getCachedTelnetCapabilities(nextSnapshot.cacheKey, nextDeviceInfo)).toEqual(nextSnapshot);
  });

  it("logs and keeps the in-memory snapshot when persistence throws", () => {
    const deviceInfo = buildDeviceInfo();
    const snapshot = buildSnapshot("u64-1|u64|Ultimate 64 Elite|3.14e|F5");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      expect(rememberTelnetCapabilities(snapshot, deviceInfo)).toEqual(snapshot);
      expect(getCachedTelnetCapabilities(snapshot.cacheKey, deviceInfo)).toEqual(snapshot);
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "warn",
        "TelnetCapabilityCache: failed to persist capability snapshot",
        expect.objectContaining({
          cacheKey: snapshot.cacheKey,
          error: "quota exceeded",
        }),
      );
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
