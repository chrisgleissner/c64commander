/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_TOUR_STATE, hasPriorAppState, shouldOfferTourOnLaunch } from "@/lib/tour/tourState";

describe("who is offered the tour on launch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /*
   * The tour's storage key is new, so it is absent on a first launch AND on every upgrade. Offering
   * on absence alone would have put a full-screen overlay in front of the entire existing user base
   * the first time they opened the app after an update.
   */
  it("is offered on a genuinely new installation", () => {
    expect(shouldOfferTourOnLaunch(EMPTY_TOUR_STATE)).toBe(true);
  });

  it("is not offered to an installation that has been used before", () => {
    localStorage.setItem("c64u_current_device_host", "192.168.1.10");

    expect(hasPriorAppState()).toBe(true);
    expect(shouldOfferTourOnLaunch(EMPTY_TOUR_STATE)).toBe(false);
  });

  it("ignores storage that is not this app's", () => {
    localStorage.setItem("some-other-app", "1");

    expect(hasPriorAppState()).toBe(false);
    expect(shouldOfferTourOnLaunch(EMPTY_TOUR_STATE)).toBe(true);
  });

  it("is still not offered once it has been taken or skipped", () => {
    expect(shouldOfferTourOnLaunch({ ...EMPTY_TOUR_STATE, completedAt: 1 })).toBe(false);
    expect(shouldOfferTourOnLaunch({ ...EMPTY_TOUR_STATE, skippedAt: 1 })).toBe(false);
  });
});
