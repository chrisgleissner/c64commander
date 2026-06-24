/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  dedupeByFingerprint,
  fingerprintFromUiNode,
  fingerprintKey,
  inferRole,
  isPositionalFingerprint,
} from "../src/cta/fingerprint.js";
import type { UiNode } from "../src/validation/appFirstUi.js";

function node(overrides: Partial<UiNode> = {}): UiNode {
  return {
    text: "",
    resourceId: "",
    className: "android.widget.Button",
    contentDesc: "",
    clickable: true,
    enabled: true,
    selected: false,
    focused: false,
    bounds: "[0,0][100,100]",
    ...overrides,
  };
}

describe("inferRole", () => {
  it("maps common Android widget classes to control roles", () => {
    expect(inferRole("android.widget.Button")).toBe("button");
    expect(inferRole("android.widget.CheckBox")).toBe("checkbox");
    expect(inferRole("android.widget.Switch")).toBe("switch");
    expect(inferRole("android.widget.SeekBar")).toBe("slider");
    expect(inferRole("android.widget.EditText")).toBe("text-input");
    expect(inferRole("android.widget.RadioButton")).toBe("segmented");
  });

  it("falls back to unknown for unrecognized classes", () => {
    expect(inferRole("android.widget.FrameLayout")).toBe("unknown");
    expect(inferRole(undefined)).toBe("unknown");
  });
});

describe("fingerprintKey identity tiers", () => {
  it("prefers a semantic test id", () => {
    const key = fingerprintKey({ route: "/play", testId: "playlist-play", className: "Button" });
    expect(key).toBe("tid|/play||playlist-play");
  });

  it("falls back to resource id when no test id is present", () => {
    const key = fingerprintKey({
      route: "/play",
      resourceId: "uk.gleissner.c64commander:id/play",
      className: "Button",
    });
    expect(key.startsWith("rid|/play||")).toBe(true);
  });

  it("falls back to label + role when no id is present", () => {
    const key = fingerprintKey({ route: "/", label: "Reset", className: "Button" });
    expect(key).toBe("lbl|/||button|reset");
  });

  it("uses a positional fallback only when no semantic identity exists", () => {
    const input = { route: "/config", stableAncestorId: "audio-mixer", siblingIndex: 3, className: "FrameLayout" };
    const key = fingerprintKey(input);
    expect(key).toBe("pos|/config||audio-mixer|unknown|3");
    expect(isPositionalFingerprint(input)).toBe(true);
  });

  it("scope includes route, overlay, and scroll container so identical labels in different scopes do not collide", () => {
    const dialog = fingerprintKey({ route: "/play", overlay: "add-items", label: "Cancel", className: "Button" });
    const page = fingerprintKey({ route: "/play", label: "Cancel", className: "Button" });
    expect(dialog).not.toBe(page);
  });
});

describe("dedupeByFingerprint", () => {
  it("keeps the first occurrence of each identity and drops later duplicates", () => {
    const inputs = [
      { route: "/play", testId: "a" },
      { route: "/play", testId: "a" },
      { route: "/play", testId: "b" },
      { route: "/play", testId: "a" },
    ];
    const deduped = dedupeByFingerprint(inputs);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.testId).toBe("a");
    expect(deduped[1]!.testId).toBe("b");
  });
});

describe("fingerprintFromUiNode adapter", () => {
  it("maps parsed uiautomator node attributes onto the fingerprint input", () => {
    const input = fingerprintFromUiNode(
      node({ text: "Play", contentDesc: "Play selected", resourceId: "id/play", className: "android.widget.Button" }),
      { route: "/play", testId: "playlist-play" },
    );
    expect(input.role).toBe("button");
    expect(input.label).toBe("Play");
    expect(input.accessibilityLabel).toBe("Play selected");
    expect(input.resourceId).toBe("id/play");
    expect(input.testId).toBe("playlist-play");
    expect(fingerprintKey(input)).toBe("tid|/play||playlist-play");
  });

  it("produces a positional fingerprint when the node lacks any semantic identity", () => {
    const input = fingerprintFromUiNode(
      node({ text: "", contentDesc: "", resourceId: "", className: "android.view.View" }),
      {
        route: "/disks",
        scrollContainerId: "disk-list",
        stableAncestorId: "disk-row-7",
        siblingIndex: 2,
      },
    );
    expect(isPositionalFingerprint(input)).toBe(true);
  });
});
