/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * `av-latency` reads the per-tone lag, and carries a broadband slot slip as a warning.
 *
 * Run 2026-10-02T13-54-22 reported 750 ms while the per-tone lag of the same capture was 272 ms:
 * the broadband envelope correlation took a peak two 239.4 ms barcode slots away. The probe now
 * reports the per-tone lag as LATENCY and prints the disagreement as a WARNING line; these cases
 * check the gate reads that line and refuses output that does not say which lag it reported.
 */

import { describe, expect, it } from "vitest";

import { gradeLatencyOutput } from "../../../tools/hil/merge_gate.mjs";

/** `mirror_audio_latency_hil.py` output for the 13-54-22 capture, trimmed to the lines the gate reads. */
const slippedRun = `wire      8.0s from 239.0.1.65:11001
mic       7.9s from plughw:CARD=SF558,DEV=0
skew      capture starts differ by +131.0 ms (already included below)
peak      correlation 0.457 at 618.9 ms into the window
LATENCY   272 ms  Ultimate wire -> phone speaker, per-tone (+-15 ms)
peaks     #1 750 ms (0.457)   #2 272 ms (0.376)   #3 511 ms (0.348)
per-tone  barcode-aware lag 272 ms (score 0.944); next 541 ms (-0.076), 605 ms (-0.078)
WARNING   broadband peak 750 ms is +2.00 slots (+478 ms) from the per-tone lag: the barcode's envelope repeats every 239.4 ms, so the broadband correlation took another slot; the reading is the per-tone lag`;

/** What the probe printed for the same capture before it read the per-tone lag. */
const broadbandOnlyRun = `peak      correlation 0.457 at 618.9 ms into the window
LATENCY   750 ms  Ultimate wire -> phone speaker (+-15 ms)
per-tone  barcode-aware lag 272 ms (score 0.944); next 541 ms (-0.076), 605 ms (-0.078)`;

describe("gradeLatencyOutput", () => {
  it("reads the per-tone lag of a run whose broadband peak slipped two slots, not 750 ms", () => {
    const graded = gradeLatencyOutput(slippedRun);
    expect(graded).toMatchObject({ latencyMs: 272, source: "per-tone", strength: 0.457 });
    expect(graded.detail).toMatch(/^272 ms wire -> speaker \(per-tone lag; broadband correlation 0\.457\)/);
  });

  it("carries the broadband disagreement into the stage detail as a measurement warning", () => {
    const graded = gradeLatencyOutput(slippedRun);
    expect(graded.warning).toMatch(/^broadband peak 750 ms is \+2\.00 slots/);
    expect(graded.detail).toContain("; measurement warning: broadband peak 750 ms is +2.00 slots");
  });

  it("has no warning when the two correlations agree", () => {
    const agreeing = slippedRun.replace(/^WARNING.*$/m, "");
    const graded = gradeLatencyOutput(agreeing);
    expect(graded.warning).toBeNull();
    expect(graded.detail).not.toContain("warning");
  });

  it("refuses output whose LATENCY line does not say which correlation it read", () => {
    expect(() => gradeLatencyOutput(broadbandOnlyRun)).toThrow(/no LATENCY line naming the correlation/);
  });

  it("names a negative latency as misaligned captures, not as a missing LATENCY line", () => {
    const negative = slippedRun.replace(/^LATENCY\s+272 ms/m, "LATENCY   -40 ms");
    expect(() => gradeLatencyOutput(negative)).toThrow(/negative latency \(-40 ms\)/);
  });

  it("refuses output with no correlation strength", () => {
    expect(() => gradeLatencyOutput(slippedRun.replace(/^peak.*$/m, ""))).toThrow(/correlation strength/);
  });
});
