/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { checkCapabilities, requiredDroidmindCapabilities } from "../src/cta/capabilities.js";

describe("CTA MCP capability checks", () => {
  it("passes when all required DroidMind tools and actions are present", () => {
    const result = checkCapabilities([
      { name: "android-device", inputSchema: { properties: { action: { enum: ["list_devices"] } } } },
      { name: "android-app", inputSchema: { properties: { action: { enum: ["start_app", "stop_app"] } } } },
      {
        name: "android-ui",
        inputSchema: { properties: { action: { enum: ["tap", "swipe", "press_key", "input_text"] } } },
      },
      { name: "android-shell" },
      { name: "android-screenshot" },
    ]);

    expect(result).toEqual({ satisfied: true, missing: [] });
  });

  it("reports missing tools and missing enumerated actions", () => {
    const result = checkCapabilities(
      [
        { name: "android-device", inputSchema: { properties: { action: { enum: ["list_devices"] } } } },
        { name: "android-ui", inputSchema: { properties: { action: { enum: ["tap"] } } } },
      ],
      requiredDroidmindCapabilities,
    );

    expect(result.satisfied).toBe(false);
    expect(result.missing.map((entry) => entry.id)).toEqual([
      "app-start",
      "app-stop",
      "ui-swipe",
      "ui-key",
      "ui-text",
      "shell-read",
      "screenshot",
    ]);
  });
});
