/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { SidcorrParseError } from "@/lib/sidRadio/sidcorrTiny";
import { buildReadyStats, isWorkerGlobalScope, toWorkerErrorMessage } from "@/lib/sidRadio/sidRadioWorkerCore";
import { buildDefaultTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

describe("sidRadioWorkerCore", () => {
  it("buildReadyStats parses the bundle and surfaces §9.4 counters", () => {
    const stats = buildReadyStats(buildDefaultTinyFixture(), false);
    expect(stats.fileCount).toBe(3);
    expect(stats.trackCount).toBe(4);
    expect(stats.styleCount).toBe(9);
    expect(stats.edgeCount).toBe(5); // 0←1, 0←2, 1←2, 2←3, 0←3
    expect(stats.memoryEstimateBytes).toBeGreaterThan(0);
    expect(stats.engineThreadIsMain).toBe(false);
  });

  it("propagates engineThreadIsMain from the caller (worker sets it false)", () => {
    expect(buildReadyStats(buildDefaultTinyFixture(), true).engineThreadIsMain).toBe(true);
  });

  it("throws a typed parse error on a malformed bundle", () => {
    const bad = new ArrayBuffer(8);
    expect(() => buildReadyStats(bad, false)).toThrow(SidcorrParseError);
  });

  it("maps errors to a typed worker error message (never throws past the boundary)", () => {
    expect(toWorkerErrorMessage(new SidcorrParseError("magic", "bad magic"))).toEqual({
      type: "error",
      code: "magic",
      message: "bad magic",
    });
    expect(toWorkerErrorMessage(new Error("boom"))).toEqual({
      type: "error",
      code: "worker-error",
      message: "boom",
    });
  });

  it("reports it is not a worker global scope under the test runner", () => {
    expect(isWorkerGlobalScope()).toBe(false);
  });
});
