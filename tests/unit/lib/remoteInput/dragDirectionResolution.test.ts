/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { DRAG_DEAD_ZONE_FRACTION, resolveDragDirections } from "@/lib/remoteInput/dragDirectionResolution";

const RADIUS = 60;

describe("resolveDragDirections", () => {
  it("resolves a pure axis push to a single direction", () => {
    expect(resolveDragDirections(RADIUS, 0, RADIUS)).toEqual(["right"]);
    expect(resolveDragDirections(-RADIUS, 0, RADIUS)).toEqual(["left"]);
    expect(resolveDragDirections(0, RADIUS, RADIUS)).toEqual(["down"]);
    expect(resolveDragDirections(0, -RADIUS, RADIUS)).toEqual(["up"]);
  });

  it("resolves a diagonal to two directions (8-way)", () => {
    expect(resolveDragDirections(RADIUS, -RADIUS, RADIUS)).toEqual(["right", "up"]);
    expect(resolveDragDirections(-RADIUS, RADIUS, RADIUS)).toEqual(["left", "down"]);
  });

  it("returns no direction inside the radius-scaled dead zone", () => {
    const insideDeadZone = RADIUS * DRAG_DEAD_ZONE_FRACTION - 1;
    expect(resolveDragDirections(insideDeadZone, 0, RADIUS)).toEqual([]);
  });

  it("resolves once displacement passes the dead zone", () => {
    const pastDeadZone = RADIUS * DRAG_DEAD_ZONE_FRACTION + 1;
    expect(resolveDragDirections(pastDeadZone, 0, RADIUS)).toEqual(["right"]);
  });

  it("scales the dead zone with the reference radius", () => {
    // The same displacement is inside the dead zone for a large pad but outside
    // it for a small one - proving the threshold is relative, not absolute.
    expect(resolveDragDirections(20, 0, 200)).toEqual([]);
    expect(resolveDragDirections(20, 0, 40)).toEqual(["right"]);
  });
});
