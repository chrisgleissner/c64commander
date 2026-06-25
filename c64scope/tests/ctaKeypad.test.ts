/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { normalizeKeypadStatuses, recordKeypadStatus, summarizeKeypadCoverage } from "../src/cta/keypad.js";

describe("CTA keypad coverage", () => {
  it("normalizes status order and removes duplicates", () => {
    expect(normalizeKeypadStatuses(["TOUCH_ACTIVATABLE", "DISCOVERED", "DISCOVERED"])).toEqual([
      "DISCOVERED",
      "TOUCH_ACTIVATABLE",
    ]);
  });

  it("records status progression without mutating the previous record", () => {
    const original = { fingerprint: "button-a", statuses: ["DISCOVERED" as const] };
    const updated = recordKeypadStatus(original, "KEYPAD_ACTIVATABLE", { keyCode: 23, note: "center" });

    expect(original.statuses).toEqual(["DISCOVERED"]);
    expect(updated).toEqual({
      fingerprint: "button-a",
      statuses: ["DISCOVERED", "KEYPAD_ACTIVATABLE"],
      lastKeyCode: 23,
      notes: ["center"],
    });
  });

  it("summarizes keypad and touch parity gaps", () => {
    const summary = summarizeKeypadCoverage([
      { fingerprint: "a", statuses: ["DISCOVERED", "KEYPAD_ACTIVATABLE", "TOUCH_ACTIVATABLE"] },
      { fingerprint: "b", statuses: ["DISCOVERED", "TOUCH_ACTIVATABLE"] },
      { fingerprint: "c", statuses: ["DISCOVERED", "KEYPAD_ACTIVATABLE"] },
    ]);

    expect(summary).toMatchObject({
      discovered: 3,
      keypadActivatable: 2,
      touchActivatable: 2,
      keypadOnlyGaps: ["b"],
      touchOnlyGaps: ["c"],
    });
  });
});
