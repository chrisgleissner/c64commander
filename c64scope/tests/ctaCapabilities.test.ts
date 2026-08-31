/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { checkCapabilities, requiredDroidctlCapabilities } from "../src/cta/capabilities.js";

const allTools = requiredDroidctlCapabilities.map((requirement) => ({ name: requirement.toolName }));

describe("CTA MCP capability checks", () => {
  it("requires exactly the droidctl tools the gate runners call", () => {
    expect(requiredDroidctlCapabilities.map((entry) => entry.toolName)).toEqual([
      "droid_target.list_targets",
      "droid_app.start_app",
      "droid_app.stop_app",
      "droid_input.tap",
      "droid_input.swipe",
      "droid_input.press_key",
      "droid_input.input_text",
      "droid_device.run_shell",
      "droid_capture.ui_hierarchy",
      "droid_capture.screenshot",
    ]);
  });

  it("passes when every required droidctl tool is present", () => {
    expect(checkCapabilities(allTools)).toEqual({ satisfied: true, missing: [] });
  });

  it("reports each missing tool by id, so preflight still fails loudly", () => {
    const result = checkCapabilities(
      [{ name: "droid_target.list_targets" }, { name: "droid_input.tap" }],
      requiredDroidctlCapabilities,
    );

    expect(result.satisfied).toBe(false);
    expect(result.missing.map((entry) => entry.id)).toEqual([
      "app-start",
      "app-stop",
      "ui-swipe",
      "ui-key",
      "ui-text",
      "shell-read",
      "ui-hierarchy",
      "screenshot",
    ]);
  });

  it("still honours an enumerated action when a requirement names one", () => {
    const withAction = [{ id: "legacy", toolName: "multi-tool", action: "tap" }];
    expect(
      checkCapabilities(
        [{ name: "multi-tool", inputSchema: { properties: { action: { enum: ["swipe"] } } } }],
        withAction,
      ).satisfied,
    ).toBe(false);
    expect(
      checkCapabilities(
        [{ name: "multi-tool", inputSchema: { properties: { action: { enum: ["tap"] } } } }],
        withAction,
      ).satisfied,
    ).toBe(true);
  });
});
