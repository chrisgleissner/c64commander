/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain Node ESM, shared with the gate that has no types of its own.
import { percentile } from "../../../tools/hil/percentile.mjs";

/*
 * The rule the search-latency gate passes or fails a build on. It used to have a copy in
 * src/lib/search/latencyProbe.ts, and the tests were written against that one while the gate ran
 * its own inline version, so nothing asserted the rule that actually decided anything.
 */
describe("the HIL percentile", () => {
  /*
   * Nearest-rank, and the reason the HIL stage takes 120 samples: at 20 the p95 is the 19th of 20,
   * which is one of the two worst observations rather than an estimate of anything.
   */
  it("takes the nearest rank", () => {
    const values = Array.from({ length: 100 }, (_unused, index) => index + 1);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.5)).toBe(50);
  });

  it("is the worst value at the top", () => {
    expect(percentile([5, 1, 3], 1)).toBe(5);
  });

  it("is the best value at the bottom", () => {
    expect(percentile([5, 1, 3], 0)).toBe(1);
  });

  it("has no answer with no samples", () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  // The gate sorts before it reports the shape of the distribution; the rule sorts for itself too.
  it("does not depend on the order it is given", () => {
    expect(percentile([9, 1, 5, 3, 7], 0.6)).toBe(percentile([1, 3, 5, 7, 9], 0.6));
  });
});
