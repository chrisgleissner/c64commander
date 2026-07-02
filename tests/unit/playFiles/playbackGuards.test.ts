/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { releaseSingleFlight, tryAcquireSingleFlight, type BooleanRef } from "@/pages/playFiles/playbackGuards";
import { resolvePlayTargetIndex } from "@/pages/playFiles/playFilesUtils";

describe("playbackGuards", () => {
  it("starts from first item when playlist has items and no prior playback", () => {
    expect(resolvePlayTargetIndex(3, -1)).toBe(0);
  });

  it("uses current index when playback already has a selected item", () => {
    expect(resolvePlayTargetIndex(3, 2)).toBe(2);
  });

  it("returns null when playlist is empty (BRDA:105 TRUE)", () => {
    expect(resolvePlayTargetIndex(0, 0)).toBeNull();
    expect(resolvePlayTargetIndex(-1, 0)).toBeNull();
  });

  it("wraps to first item when current index exceeds playlist length (BRDA:107 FALSE)", () => {
    expect(resolvePlayTargetIndex(3, 5)).toBe(0);
    expect(resolvePlayTargetIndex(3, 3)).toBe(0);
  });

  it("prevents duplicate single-flight start requests during rapid taps", () => {
    const lock: BooleanRef = { current: false };
    expect(tryAcquireSingleFlight(lock)).toBe(true);
    expect(tryAcquireSingleFlight(lock)).toBe(false);
    releaseSingleFlight(lock);
    expect(tryAcquireSingleFlight(lock)).toBe(true);
  });
});
