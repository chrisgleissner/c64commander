/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { createCtaScrollDriver, runCtaCensus } from "../src/cta/ctaCensus.js";
import type { AgenticController } from "../src/cta/controller.js";

const xmlFor = (label: string): string => `
  <hierarchy>
    <node text="${label}" class="android.widget.Button" clickable="true" enabled="true" selected="false" focused="false" bounds="[0,0][100,100]" content-desc="" resource-id="" />
  </hierarchy>
`;

describe("CTA census runtime adapter", () => {
  it("captures hierarchy through the controller and scrolls to a fixed point", async () => {
    const hierarchies = [xmlFor("Docs"), xmlFor("Licenses"), xmlFor("Licenses"), xmlFor("Licenses")];
    const controller: AgenticController = {
      async captureUiHierarchy() {
        return hierarchies.shift() ?? xmlFor("Licenses");
      },
      async scrollDown() {
        return { atEnd: false };
      },
    };

    const result = await runCtaCensus(controller, "serial-1", { route: "/docs", maxScrolls: 5 });

    expect(result.discovered).toEqual(["lbl|/docs||button|docs", "lbl|/docs||button|licenses"]);
    expect(result.stopReason).toBe("fixed-point");
    expect(result.scrollAttempts).toBe(3);
  });

  it("creates a scroll driver with the configured max scrolls", async () => {
    const controller: AgenticController = {
      async captureUiHierarchy() {
        return xmlFor("Settings");
      },
      async scrollDown() {
        return { atEnd: true };
      },
    };

    const driver = createCtaScrollDriver(controller, "serial-2", { route: "/settings", maxScrolls: 7 });

    expect(driver.maxScrolls).toBe(7);
    await expect(driver.capture()).resolves.toEqual(["lbl|/settings||button|settings"]);
    await expect(driver.scroll()).resolves.toEqual({ atEnd: true });
  });
});
