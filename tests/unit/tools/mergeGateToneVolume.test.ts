/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_TONE_VOLUME, TONE_PEAK_FLOOR_DBFS, tooQuietMessage } from "../../../tools/hil/merge_gate.mjs";

describe("tone stage volume", () => {
  it("defaults to a volume that measures and stays under the comfort ceiling of 10", () => {
    expect(DEFAULT_TONE_VOLUME).toBe(8);
    expect(DEFAULT_TONE_VOLUME).toBeLessThanOrEqual(10);
  });

  it("uses the -60 dBFS floor the grader applies", () => {
    expect(TONE_PEAK_FLOOR_DBFS).toBe(-60);
  });
});

describe("tooQuietMessage", () => {
  it("names the measured peak, the shortfall against the floor and the volume used", () => {
    const message = tooQuietMessage("Remote", { peak_dbfs: -63.2 }, 4);
    expect(message).toContain("Remote: cannot be measured on this rig");
    expect(message).toContain("peaked at -63.2 dBFS");
    expect(message).toContain("3.2 dB below the -60 dBFS floor");
    expect(message).toContain("phone volume 4 of 25");
    expect(message).toContain("never above 10");
  });
});
