/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The Live View HIL gate's exit code, which is what `./build --stream-hil` reads.
 *
 * `hil_stream_fixture.py` has three outcomes the aggregator must keep apart: a product gate failed
 * (1), the rig was not usable (2), and a required gate had too little data to judge (3). The third
 * was previously folded into "streaming FAIL", which reports a regression in a threshold the run
 * never measured.
 */

import { describe, expect, it } from "vitest";

import { hilVerdict } from "../../../scripts/streams-hil.mjs";

describe("hilVerdict", () => {
  it("passes only when both fixtures passed", () => {
    expect(hilVerdict(0, 0)).toMatchObject({ exitCode: 0 });
  });

  it("reports a product failure as 1", () => {
    expect(hilVerdict(1, 0)).toMatchObject({ exitCode: 1 });
    expect(hilVerdict(0, 1)).toMatchObject({ exitCode: 1 });
    expect(hilVerdict(1, 1).exitCode).toBe(1);
  });

  it("keeps an infra failure out of the product result", () => {
    expect(hilVerdict(2, 0)).toMatchObject({ exitCode: 2 });
    expect(hilVerdict(0, 2)).toMatchObject({ exitCode: 2 });
  });

  // The regression. Exit 3 means the gate was never measured, so it is neither a pass nor a
  // product failure, and the summary has to say so rather than naming a threshold.
  it("reports an unmeasured gate as inconclusive rather than as a product failure", () => {
    const verdict = hilVerdict(3, 0);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.summary).toContain("streaming INCONCLUSIVE");
    expect(verdict.summary).not.toContain("streaming FAIL");
    expect(verdict.message).toContain("inconclusive");
  });

  it("reports an unmeasured latency gate the same way", () => {
    expect(hilVerdict(0, 3)).toMatchObject({ exitCode: 2 });
    expect(hilVerdict(0, 3).summary).toContain("latency INCONCLUSIVE");
  });

  // An unusable run outranks a product failure in the other fixture: the run as a whole did not
  // establish a product verdict, and exit 1 would claim it did.
  it("does not downgrade an inconclusive run to a product failure", () => {
    expect(hilVerdict(1, 3)).toMatchObject({ exitCode: 2 });
  });

  it("labels a pass as a pass in the summary", () => {
    expect(hilVerdict(0, 0).summary).toBe("Live View HIL: streaming PASS, latency PASS.");
  });
});
