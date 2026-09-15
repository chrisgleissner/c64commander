/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const devices = vi.hoisted(() => ({ list: [] as Array<{ lastSuccessfulConnectionAt: string | null }> }));
vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: () => ({ devices: devices.list }),
}));

import { isAwayFromKnownDevice, noteDemoOfferShown } from "@/lib/connection/demoOfferMemory";

describe("remembering that the Demo Mode offer was made", () => {
  beforeEach(() => {
    localStorage.clear();
    devices.list = [{ lastSuccessfulConnectionAt: "2026-09-15T10:00:00.000Z" }];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts a user as away from a known device once the offer was shown and a device has connected", () => {
    expect(isAwayFromKnownDevice()).toBe(false);

    noteDemoOfferShown();

    expect(isAwayFromKnownDevice()).toBe(true);
  });

  it("does not count a user whose saved devices have never connected", () => {
    noteDemoOfferShown();
    devices.list = [{ lastSuccessfulConnectionAt: null }];

    expect(isAwayFromKnownDevice()).toBe(false);
  });

  it("makes the offer again when storage cannot be used", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => noteDemoOfferShown()).not.toThrow();
    expect(isAwayFromKnownDevice()).toBe(false);
  });
});
