/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  activeBottomTabLabel,
  findBottomTabByText,
  findVisibleText,
  hasVisibleText,
  parseBoundsCenter,
  parseBoundsRect,
  parseUiNodes,
} from "../src/validation/appFirstUi.js";

const sampleXml = `
<hierarchy rotation="0">
  <node text="Home" class="android.widget.Button" clickable="true" enabled="true" bounds="[30,1731][189,1887]" />
  <node text="Play" class="android.widget.Button" clickable="true" enabled="true" bounds="[198,1731][345,1887]" />
  <node text="CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
</hierarchy>
`;

describe("app-first UI XML parsing", () => {
  it("parses nodes and finds text markers", () => {
    const nodes = parseUiNodes(sampleXml);
    expect(nodes.length).toBe(3);
    expect(hasVisibleText(nodes, "home")).toBe(true);
    expect(hasVisibleText(nodes, "missing")).toBe(false);

    const play = findVisibleText(nodes, "Play");
    expect(play).not.toBeNull();
    expect(play?.clickable).toBe(true);
    expect(play?.bounds).toBe("[198,1731][345,1887]");
    expect(play?.resourceId).toBe("");
    expect(play?.focused).toBe(false);
  });

  it("parses bounds center coordinates", () => {
    const center = parseBoundsCenter("[198,1731][345,1887]");
    expect(center).toEqual({ x: 271, y: 1809 });
    expect(parseBoundsRect("[198,1731][345,1887]")).toEqual({ left: 198, top: 1731, right: 345, bottom: 1887 });
    expect(parseBoundsCenter("invalid")).toBeNull();
    expect(parseBoundsCenter("[1,1][1,1]")).toBeNull();
    expect(parseBoundsRect("invalid")).toBeNull();
  });

  it("finds bottom tab nodes and resolves active tab by focus", () => {
    const tabXml = `
    <hierarchy rotation="0">
      <node text="Home" class="android.widget.Button" clickable="true" enabled="true" focused="false" bounds="[30,1731][189,1887]" />
      <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
      <node text="Home" class="android.widget.TextView" clickable="false" enabled="true" focused="false" bounds="[120,430][260,480]" />
    </hierarchy>
    `;
    const nodes = parseUiNodes(tabXml);
    const playTab = findBottomTabByText(nodes, "play", 1700);
    expect(playTab).not.toBeNull();
    expect(playTab?.className).toBe("android.widget.Button");

    const activeTab = activeBottomTabLabel(nodes, ["Home", "Play", "Disks"], 1700);
    expect(activeTab).toBe("Play");
  });

  it("decodes XML entities and rejects invisible or non-bottom matches", () => {
    const xml = `
    <hierarchy rotation="0">
      <node text="Home &amp; Docs" class="android.widget.Button" clickable="true" enabled="true" selected="true" bounds="[30,1731][189,1887]" />
      <node text="Play" class="android.widget.Button" clickable="true" enabled="false" bounds="[198,1731][345,1887]" />
      <node text="Config" class="android.widget.Button" clickable="true" enabled="true" bounds="[198,1200][345,1300]" />
      <node text="Broken" class="android.widget.Button" clickable="true" enabled="true" bounds="invalid" />
    </hierarchy>
    `;

    const nodes = parseUiNodes(xml);

    expect(nodes[0]?.text).toBe('Home & Docs');
    expect(findVisibleText(nodes, "Play")).toBeNull();
    expect(findBottomTabByText(nodes, "Config", 1700)).toBeNull();
    expect(activeBottomTabLabel(nodes, ["Home & Docs", "Play"], 1700)).toBe("Home & Docs");
  });

  it("returns null when no active bottom tab is selected or focused", () => {
    const xml = `
    <hierarchy rotation="0">
      <node text="Home" class="android.widget.Button" clickable="true" enabled="true" bounds="[30,1731][189,1887]" />
      <node text="Docs" class="android.widget.Button" clickable="true" enabled="true" bounds="[900,1731][1040,1887]" />
    </hierarchy>
    `;

    const nodes = parseUiNodes(xml);
    expect(activeBottomTabLabel(nodes, ["Home", "Docs"], 1700)).toBeNull();
  });
});
