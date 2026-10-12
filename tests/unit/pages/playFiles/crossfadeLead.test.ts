/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  autoAdvanceDelayMs,
  CROSSFADE_START_MARGIN_MS,
  crossfadeLeadMs,
  deferralToTuneEndMs,
} from "@/pages/playFiles/crossfadeLead";

describe("the crossfade lead", () => {
  afterEach(() => localStorage.clear());

  it("is the crossfade and the start margin for a tune on the phone", () => {
    expect(crossfadeLeadMs(180_000, true, 1500)).toBe(1500 + CROSSFADE_START_MARGIN_MS);
  });

  it("is the start margin alone with the crossfade off, so the cut still has audio to ramp out", () => {
    expect(crossfadeLeadMs(180_000, true, 0)).toBe(CROSSFADE_START_MARGIN_MS);
  });

  it("is nothing for a tune on the C64", () => {
    expect(crossfadeLeadMs(180_000, false, 4000)).toBe(0);
    expect(crossfadeLeadMs(180_000, false, 0)).toBe(0);
  });

  it("never takes more than half of a short tune", () => {
    expect(crossfadeLeadMs(3000, true, 4000)).toBe(1500);
  });

  it("reads the listener's crossfade setting when none is passed", () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "3000");
    expect(crossfadeLeadMs(180_000, true)).toBe(3000 + CROSSFADE_START_MARGIN_MS);
  });

  it("makes the next tune due that much before the songlength, and never in the past", () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "600");
    expect(autoAdvanceDelayMs(60_000, 20_000, true)).toBe(40_000 - 600 - CROSSFADE_START_MARGIN_MS);
    expect(autoAdvanceDelayMs(60_000, 20_000, false)).toBe(40_000);
    expect(autoAdvanceDelayMs(60_000, 59_900, true)).toBe(0);
  });

  it("defers an early advance to the tune's end once, and not again", () => {
    expect(deferralToTuneEndMs(false, 116_000, 120_000)).toBe(120_000);
    expect(deferralToTuneEndMs(true, 116_000, 120_000)).toBeNull();
    expect(deferralToTuneEndMs(false, 120_000, 120_000)).toBeNull();
  });
});
