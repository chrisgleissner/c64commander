/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { resolveSwipeDirections, SWIPE_MAX_DURATION_MS, SWIPE_MIN_DISTANCE_PX } from "@/lib/remoteInput/swipeGesture";

describe("resolveSwipeDirections", () => {
  it("resolves a fast rightward flick", () => {
    expect(resolveSwipeDirections({ dx: 60, dy: 0, durationMs: 100 })).toEqual(["right"]);
  });

  it("resolves a fast upward flick (negative dy is up in screen coordinates)", () => {
    expect(resolveSwipeDirections({ dx: 0, dy: -60, durationMs: 100 })).toEqual(["up"]);
  });

  it("resolves a diagonal flick to two directions", () => {
    expect(resolveSwipeDirections({ dx: 60, dy: -60, durationMs: 100 })).toEqual(["right", "up"]);
  });

  it("ignores a gesture shorter than the minimum swipe distance (jitter/tap)", () => {
    expect(resolveSwipeDirections({ dx: SWIPE_MIN_DISTANCE_PX - 1, dy: 0, durationMs: 50 })).toEqual([]);
  });

  it("accepts a gesture right at the minimum distance threshold", () => {
    expect(resolveSwipeDirections({ dx: SWIPE_MIN_DISTANCE_PX, dy: 0, durationMs: 50 })).toEqual(["right"]);
  });

  it("ignores a slow drag even if the distance is large (that is the stick/D-pad's job, not a swipe)", () => {
    expect(resolveSwipeDirections({ dx: 200, dy: 0, durationMs: SWIPE_MAX_DURATION_MS + 1 })).toEqual([]);
  });

  it("accepts a gesture right at the maximum duration threshold", () => {
    expect(resolveSwipeDirections({ dx: 60, dy: 0, durationMs: SWIPE_MAX_DURATION_MS })).toEqual(["right"]);
  });

  it("ignores a stationary long-press (zero distance)", () => {
    expect(resolveSwipeDirections({ dx: 0, dy: 0, durationMs: 250 })).toEqual([]);
  });
});
