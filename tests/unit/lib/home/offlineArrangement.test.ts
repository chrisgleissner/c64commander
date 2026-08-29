/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  OFFLINE_SETTLE_MS,
  isUntouchedBootstrapDefault,
  resolveOfflineArrangement,
} from "@/lib/home/offlineArrangement";
import type { SavedDevice } from "@/lib/savedDevices/store";

const bootstrapDefault = (overrides: Partial<SavedDevice> = {}): SavedDevice => ({
  id: "device-1",
  name: "c64u",
  nameSource: "INFERRED",
  host: "c64u",
  type: "",
  typeSource: "INFERRED",
  httpPort: 80,
  ftpPort: 21,
  telnetPort: 23,
  lastKnownProduct: null,
  lastKnownHostname: null,
  lastKnownUniqueId: null,
  lastSuccessfulConnectionAt: null,
  lastUsedAt: null,
  hasPassword: false,
  ...overrides,
});

const T0 = 1_000_000;

const arrangement = (overrides: Partial<Parameters<typeof resolveOfflineArrangement>[0]> = {}) =>
  resolveOfflineArrangement({
    isConnected: false,
    selectedDevice: bootstrapDefault({ lastSuccessfulConnectionAt: "2026-01-01T00:00:00.000Z" }),
    unreachableSinceMs: T0,
    nowMs: T0,
    pinned: false,
    current: false,
    ...overrides,
  });

describe("isUntouchedBootstrapDefault", () => {
  it("is true for the device bootstrapped on a first launch", () => {
    expect(isUntouchedBootstrapDefault(bootstrapDefault())).toBe(true);
  });

  it("is false once the device has ever connected", () => {
    expect(
      isUntouchedBootstrapDefault(bootstrapDefault({ lastSuccessfulConnectionAt: "2026-01-01T00:00:00.000Z" })),
    ).toBe(false);
  });

  it("is false once the user has named it", () => {
    expect(isUntouchedBootstrapDefault(bootstrapDefault({ nameSource: "USER" }))).toBe(false);
  });

  it("is false once the host has been edited", () => {
    expect(isUntouchedBootstrapDefault(bootstrapDefault({ host: "192.168.1.64" }))).toBe(false);
  });

  it("is false for no device at all, which is not a state this app can reach anyway", () => {
    expect(isUntouchedBootstrapDefault(null)).toBe(false);
  });
});

describe("resolveOfflineArrangement", () => {
  it("is connected while a device is connected, however long it was away before", () => {
    expect(arrangement({ isConnected: true, unreachableSinceMs: T0 - 60_000 })).toBe(false);
  });

  it("returns to the connected arrangement immediately on a successful connection", () => {
    expect(arrangement({ isConnected: true, current: true })).toBe(false);
  });

  it("is offline on a first run, before anything has ever connected", () => {
    expect(arrangement({ selectedDevice: bootstrapDefault(), unreachableSinceMs: null })).toBe(true);
  });

  describe("the flap threshold", () => {
    it("does not rearrange at 8 seconds minus one millisecond", () => {
      expect(arrangement({ nowMs: T0 + OFFLINE_SETTLE_MS - 1 })).toBe(false);
    });

    it("rearranges at exactly 8 seconds", () => {
      expect(arrangement({ nowMs: T0 + OFFLINE_SETTLE_MS })).toBe(true);
    });

    it("rearranges at 9 seconds", () => {
      expect(arrangement({ nowMs: T0 + 9_000 })).toBe(true);
    });

    it("settles at 8 seconds, which is the value the spec names", () => {
      expect(OFFLINE_SETTLE_MS).toBe(8_000);
    });
  });

  describe("pinning", () => {
    it("keeps what is drawn while an overlay is open, even once the threshold has passed", () => {
      expect(arrangement({ nowMs: T0 + 60_000, pinned: true, current: false })).toBe(false);
    });

    it("keeps the offline arrangement while pinned, rather than snapping back mid-dialog", () => {
      // A reconnection reflows the page under the overlay just as much as a disconnection does.
      expect(arrangement({ isConnected: true, pinned: true, current: true })).toBe(true);
    });

    it("applies the deferred change as soon as the pin lifts", () => {
      expect(arrangement({ nowMs: T0 + 60_000, pinned: false, current: false })).toBe(true);
    });
  });
});
