/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import type { SavedDevice, SavedDevicesSnapshot } from "@/lib/savedDevices/store";
import { areSavedEntriesSameDevice, describeSameDeviceEntry, savedEntryIsMachine } from "@/lib/savedDevices/sameDevice";

const entry = (
  id: string,
  host: string,
  lastKnownUniqueId: string | null,
  lastKnownHostname: string | null = lastKnownUniqueId ? "ultimate-desk" : null,
): SavedDevice => ({
  id,
  name: id,
  host,
  httpPort: 80,
  ftpPort: 21,
  telnetPort: 23,
  lastKnownProduct: "U64E",
  lastKnownHostname,
  lastKnownUniqueId,
  lastSuccessfulConnectionAt: null,
  lastUsedAt: null,
  hasPassword: false,
});

const snapshotOf = (devices: SavedDevice[], verifiedByDeviceId: SavedDevicesSnapshot["verifiedByDeviceId"] = {}) =>
  ({
    selectedDeviceId: devices[0].id,
    devices,
    summaries: {},
    summaryLru: [],
    hasEverHadMultipleDevices: devices.length > 1,
    runtimeStatuses: {},
    verifiedByDeviceId,
    actualDeviceIdByDeviceId: {},
  }) satisfies SavedDevicesSnapshot;

// One Ultimate on Ethernet (192.0.2.0/24) and Wi-Fi (198.51.100.0/24), and a second Ultimate.
const wired = entry("wired", "192.0.2.10", "DUAL01");
const wireless = entry("wireless", "198.51.100.20", "dual01");
const other = entry("other", "203.0.113.30", "OTHER1", "ultimate-attic");
const unverified = entry("unverified", "203.0.113.31", null);

describe("saved entries for the same device", () => {
  it("treats entries with the same stored unique id and hostname as one device, ignoring case", () => {
    const snapshot = snapshotOf([wired, wireless, other]);

    expect(areSavedEntriesSameDevice("wired", "wireless", snapshot)).toBe(true);
    expect(areSavedEntriesSameDevice("wired", "other", snapshot)).toBe(false);
    expect(areSavedEntriesSameDevice("wired", "wired", snapshot)).toBe(false);
  });

  it("never treats entries without a stored id as the same device by that alone", () => {
    const snapshot = snapshotOf([unverified, entry("also-unverified", "203.0.113.32", null)]);

    expect(areSavedEntriesSameDevice("unverified", "also-unverified", snapshot)).toBe(false);
  });

  it("uses the verified identity when a stored id is missing", () => {
    const snapshot = snapshotOf([wired, unverified], {
      unverified: { product: "U64E", uniqueId: "DUAL01", hostname: "Ultimate-Desk" },
    });

    expect(areSavedEntriesSameDevice("wired", "unverified", snapshot)).toBe(true);
  });

  // The unique id is user-configurable (Network Settings), so two Ultimates can report the same one.
  it("does not treat two devices that share a custom unique id but not a hostname as one device", () => {
    const attic = entry("attic", "203.0.113.40", "DUAL01", "ultimate-attic");
    const noHostname = entry("no-hostname", "203.0.113.41", "DUAL01", null);
    const snapshot = snapshotOf([wired, attic, noHostname]);

    expect(areSavedEntriesSameDevice("wired", "attic", snapshot)).toBe(false);
    expect(areSavedEntriesSameDevice("wired", "no-hostname", snapshot)).toBe(false);
    expect(describeSameDeviceEntry("attic", snapshot)).toBeNull();
  });

  it("matches a saved entry against a reported unique id and hostname", () => {
    const snapshot = snapshotOf([wired, other]);

    expect(savedEntryIsMachine("wired", { uniqueId: " dual01 ", hostname: "ULTIMATE-DESK" }, snapshot)).toBe(true);
    expect(savedEntryIsMachine("wired", { uniqueId: "DUAL01", hostname: "ultimate-attic" }, snapshot)).toBe(false);
    expect(savedEntryIsMachine("wired", { uniqueId: "DUAL01", hostname: null }, snapshot)).toBe(false);
    expect(savedEntryIsMachine("wired", { uniqueId: "OTHER1", hostname: "ultimate-attic" }, snapshot)).toBe(false);
    expect(savedEntryIsMachine(null, { uniqueId: "DUAL01", hostname: "ultimate-desk" }, snapshot)).toBe(false);
  });

  it("names the other entry of the same device", () => {
    const snapshot = snapshotOf([wired, wireless, other]);

    expect(describeSameDeviceEntry("wireless", snapshot)).toBe("Same device as wired");
    expect(describeSameDeviceEntry("other", snapshot)).toBeNull();
  });
});
