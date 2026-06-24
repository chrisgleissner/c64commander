/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { appendMutation, createBaselineState, unrestoredMutations, type StateLedger } from "../src/cta/stateLedger.js";

describe("CTA state ledger", () => {
  it("creates complete empty baselines", () => {
    const baseline = createBaselineState({ capturedAt: "2026-06-24T00:00:00.000Z", settings: { theme: "dark" } });

    expect(baseline.settings).toEqual({ theme: "dark" });
    expect(baseline.playbackState).toEqual({});
  });

  it("tracks unrestored mutations without mutating the original ledger", () => {
    const ledger: StateLedger = { baseline: createBaselineState({ capturedAt: "now" }), mutations: [] };
    const updated = appendMutation(ledger, {
      mutationId: "m1",
      caseId: "case",
      route: "/settings",
      controlFingerprint: "theme",
      originalValue: "light",
      newValue: "dark",
      mutationMethod: "tap",
      expectedEffect: "theme changes",
      restorationMethod: "tap light",
      restored: false,
      recordedAt: "2026-06-24T00:00:00.000Z",
    });

    expect(ledger.mutations).toHaveLength(0);
    expect(unrestoredMutations(updated).map((entry) => entry.mutationId)).toEqual(["m1"]);
  });
});
