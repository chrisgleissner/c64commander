/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The release sweep's screen-off grader, tested off the rig.
 *
 * The stage it serves takes two minutes on a phone with its screen out, so a mistake in the
 * arithmetic costs two minutes to see and cannot be reasoned about from the result alone. One
 * already did: the grader took the last reading minus the first, the playlist moved on to the next
 * tune near the end, and a run where the music never stopped reported "the tune advanced -64 s" and
 * failed. The readings from that run are the second case below.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error -- a HIL harness is plain JavaScript with no type declarations.
import { elapsedSeconds, secondsPlayed } from "../../../tools/hil/release_sweep_hil.mjs";

describe("elapsedSeconds", () => {
  it("reads the transport clock as a number of seconds", () => {
    expect(elapsedSeconds("0:00")).toBe(0);
    expect(elapsedSeconds("1:53")).toBe(113);
    expect(elapsedSeconds("10:00")).toBe(600);
  });

  it("returns null for anything that is not a clock", () => {
    expect(elapsedSeconds(null)).toBeNull();
    expect(elapsedSeconds("—")).toBeNull();
  });
});

describe("secondsPlayed", () => {
  it("counts a clock that only ever moves forward", () => {
    expect(secondsPlayed(["1:53", "2:13", "2:33", "2:53"])).toBe(60);
  });

  it("counts the new tune's own position when the playlist moves on", () => {
    // Measured on the Pixel 4 with the screen out: five 20 s steps, then a track change, then two
    // more. 80 s before the change, 23 s after it.
    expect(secondsPlayed(["1:53", "2:13", "2:33", "2:53", "3:13", "0:03", "0:23"])).toBe(103);
  });

  it("counts nothing for a clock that never moves, which is the failure it exists to catch", () => {
    expect(secondsPlayed(["0:00", "0:00", "0:00", "0:00"])).toBe(0);
  });

  it("returns null when any reading is not a clock, rather than treating it as zero", () => {
    expect(secondsPlayed(["1:53", null, "2:33"])).toBeNull();
  });
});
