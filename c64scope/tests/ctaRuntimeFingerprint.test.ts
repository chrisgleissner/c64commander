/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { fingerprintKeysFromHierarchy, fingerprintsFromUiNodes } from "../src/cta/runtimeFingerprint.js";
import type { UiNode } from "../src/validation/appFirstUi.js";

function node(overrides: Partial<UiNode> = {}): UiNode {
  return {
    text: "",
    resourceId: "",
    className: "android.view.View",
    contentDesc: "",
    clickable: false,
    enabled: true,
    selected: false,
    focused: false,
    bounds: "[0,0][100,100]",
    ...overrides,
  };
}

describe("runtime fingerprints", () => {
  it("keeps clickable controls and extracts web test ids from accessibility text", () => {
    const fingerprints = fingerprintsFromUiNodes(
      [
        node({
          className: "android.widget.Button",
          clickable: true,
          contentDesc: 'Play data-testid="playlist-play"',
          text: "Play",
        }),
        node({ text: "Static label" }),
      ],
      { route: "/play" },
    );

    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0]!.testId).toBe("playlist-play");
    expect(fingerprints[0]!.label).toBe("Play");
  });

  it("drops disabled and unbounded nodes", () => {
    const fingerprints = fingerprintsFromUiNodes([
      node({ clickable: true, enabled: false, text: "Disabled" }),
      node({ clickable: true, bounds: "[0,0][0,0]", text: "Unbounded" }),
    ]);

    expect(fingerprints).toHaveLength(0);
  });

  it("excludes nodes owned by another package when a target package is configured", () => {
    const fingerprints = fingerprintsFromUiNodes(
      [
        node({
          packageName: "com.android.systemui",
          className: "android.widget.Button",
          clickable: true,
          text: "System",
        }),
        node({
          packageName: "uk.gleissner.c64commander",
          className: "android.widget.Button",
          clickable: true,
          text: "Docs",
        }),
      ],
      { targetPackage: "uk.gleissner.c64commander" },
    );

    expect(fingerprints.map((fingerprint) => fingerprint.label)).toEqual(["Docs"]);
  });

  it("builds stable keys from uiautomator XML", () => {
    const xml = `
      <hierarchy>
        <node text="Docs" class="android.widget.Button" clickable="true" enabled="true" selected="false" focused="false" bounds="[0,0][100,100]" content-desc="testid:tab-docs" resource-id="" />
      </hierarchy>
    `;

    expect(fingerprintKeysFromHierarchy(xml, { route: "/docs" })).toEqual(["tid|/docs||tab-docs"]);
  });
});
