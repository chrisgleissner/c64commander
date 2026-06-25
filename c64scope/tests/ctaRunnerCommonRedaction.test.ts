/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { redactUiHierarchySecrets, scrollToTop } from "../src/cta/runnerCommon.js";

describe("CTA hierarchy redaction", () => {
  it("redacts known secret literals from UI hierarchy XML", () => {
    const xml = '<node text="pwd" resource-id="password" /><node text="c64u" />';

    expect(redactUiHierarchySecrets(xml, ["pwd"])).toBe(
      '<node text="[REDACTED]" resource-id="password" /><node text="c64u" />',
    );
  });

  it("scrolls to top using coordinates derived from the captured screen size", async () => {
    const calls: Array<readonly [number, number, number, number, number]> = [];
    const client = {
      async captureUiHierarchy() {
        return '<hierarchy bounds="[0,0][1440,3200]"><node bounds="[0,0][10,10]" /></hierarchy>';
      },
      async swipe(_serial: string, startX: number, startY: number, endX: number, endY: number, durationMs: number) {
        calls.push([startX, startY, endX, endY, durationMs]);
      },
    };

    await scrollToTop(client as any, "serial-1", 1);

    expect(calls).toEqual([[720, 912, 720, 2400, 250]]);
  });
});
