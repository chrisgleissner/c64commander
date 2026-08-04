/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The hardware merge gate's most dangerous line of code.
 *
 * `av-clarity` reads its verdict out of another program's stdout, and the failure that matters is
 * not a wrong number — it is a MISSING one being read as a good one. A probe that died before its
 * analysis still leaves the earlier metrics in the output, so a parser that defaults the absent
 * verdict to zero reports a perfect run for a measurement that never happened. The gate would be
 * green for the rest of its life and nobody would look.
 *
 * These cases are the reason that parser is an exported pure function rather than four regular
 * expressions inside the stage: there is no rig in CI, and this is the part of the gate that can
 * be checked without one.
 */

import { describe, expect, it } from "vitest";

import { gradeClarityOutput } from "../../../tools/hil/merge_gate.mjs";

/** A complete run of `audio_e2e_probe.py run`, trimmed to the lines the gate reads. */
const complete = (defectiveLine: string) => `recording       20.0s at 48000 Hz
stimulus        8 tones, 159.6ms on / 79.8ms off, slot 239.40ms
bursts read     82  sequence errors 0
note length     median 159.0ms vs 159.6ms; 2 of 82 off by >10ms
DROPOUTS        0.00% of held tone (0 of 2327 x 5ms windows)
timing          mean slot 239.2ms vs 239.4ms, jitter 6.1ms, worst 27.4ms
pitch           780.8 Hz vs 780 Hz = +1.7 cents
${defectiveLine}
VERDICT         clean`;

describe("gradeClarityOutput — the numbers", () => {
  it("reads a run with defects", () => {
    expect(gradeClarityOutput(complete("defective notes  3 of 82:"))).toEqual({
      bursts: 82,
      sequenceErrors: 0,
      dropouts: 0,
      defective: 3,
    });
  });

  // The probe writes this form when nothing was wrong. It is a RESULT, not an absent line.
  it("reads the probe's own way of saying none", () => {
    expect(gradeClarityOutput(complete("defective notes  none of 82")).defective).toBe(0);
  });

  it("reads a non-zero dropout percentage and out-of-order tones", () => {
    const graded = gradeClarityOutput(
      complete("defective notes  11 of 82:")
        .replace("sequence errors 0", "sequence errors 4")
        .replace("DROPOUTS        0.00%", "DROPOUTS        1.25%"),
    );
    expect(graded).toMatchObject({ sequenceErrors: 4, dropouts: 1.25, defective: 11 });
  });
});

describe("gradeClarityOutput — what it refuses to grade", () => {
  it("refuses output that stops before the analysis, however much of it there is", () => {
    // Everything the gate reads except the verdict: a probe killed part-way through leaves exactly
    // this, and it is the case a zero-default would wave through.
    const truncated = complete("defective notes  none of 82")
      .split("\n")
      .filter((line) => !line.startsWith("defective notes") && !line.startsWith("VERDICT"))
      .join("\n");
    expect(() => gradeClarityOutput(truncated)).toThrow(/did not finish its analysis/);
  });

  it("refuses a finished run whose defect verdict is missing", () => {
    const noVerdict = complete("defective notes  none of 82").replace(/^defective notes.*$/m, "");
    expect(() => gradeClarityOutput(noVerdict)).toThrow(/no defect verdict/);
  });

  it("refuses an empty output rather than calling it perfect", () => {
    expect(() => gradeClarityOutput("")).toThrow(/did not finish its analysis/);
  });

  it("refuses a run that finished but lost an earlier metric", () => {
    const noBursts = complete("defective notes  none of 82").replace(/^bursts read.*$/m, "");
    expect(() => gradeClarityOutput(noBursts)).toThrow(/bursts read/);
  });
});
