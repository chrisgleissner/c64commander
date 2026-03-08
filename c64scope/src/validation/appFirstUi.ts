/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface UiNode {
  text: string;
  resourceId: string;
  className: string;
  contentDesc: string;
  clickable: boolean;
  enabled: boolean;
  selected: boolean;
  focused: boolean;
  bounds: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function decodeXmlEntity(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function attr(rawNode: string, key: string): string {
  const match = rawNode.match(new RegExp(`${key}="([^"]*)"`, "i"));
  if (!match) {
    return "";
  }
  return decodeXmlEntity(match[1] ?? "");
}

export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const nodeMatches = xml.match(/<node\s+[^>]*>/g) ?? [];
  for (const raw of nodeMatches) {
    nodes.push({
      text: attr(raw, "text"),
      resourceId: attr(raw, "resource-id"),
      className: attr(raw, "class"),
      contentDesc: attr(raw, "content-desc"),
      clickable: attr(raw, "clickable") === "true",
      enabled: attr(raw, "enabled") !== "false",
      selected: attr(raw, "selected") === "true",
      focused: attr(raw, "focused") === "true",
      bounds: attr(raw, "bounds"),
    });
  }
  return nodes;
}

export function parseBoundsRect(bounds: string): Rect | null {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) {
    return null;
  }
  const left = Number.parseInt(match[1] ?? "-1", 10);
  const top = Number.parseInt(match[2] ?? "-1", 10);
  const right = Number.parseInt(match[3] ?? "-1", 10);
  const bottom = Number.parseInt(match[4] ?? "-1", 10);
  if (left < 0 || top < 0 || right <= left || bottom <= top) {
    return null;
  }
  return { left, top, right, bottom };
}

export function parseBoundsCenter(bounds: string): Point | null {
  const rect = parseBoundsRect(bounds);
  if (!rect) {
    return null;
  }
  return {
    x: Math.floor((rect.left + rect.right) / 2),
    y: Math.floor((rect.top + rect.bottom) / 2),
  };
}

export function findVisibleText(nodes: readonly UiNode[], expectedText: string): UiNode | null {
  const normalized = expectedText.trim().toLowerCase();
  for (const node of nodes) {
    if (!node.text || !node.enabled) {
      continue;
    }
    if (node.text.trim().toLowerCase() === normalized) {
      const center = parseBoundsCenter(node.bounds);
      if (center) {
        return node;
      }
    }
  }
  return null;
}

export function hasVisibleText(nodes: readonly UiNode[], expectedText: string): boolean {
  return findVisibleText(nodes, expectedText) !== null;
}

function isBottomCandidate(node: UiNode, minCenterY: number): boolean {
  const center = parseBoundsCenter(node.bounds);
  if (!center) {
    return false;
  }
  return center.y >= minCenterY;
}

export function findBottomTabByText(nodes: readonly UiNode[], expectedText: string, minCenterY: number): UiNode | null {
  const normalized = expectedText.trim().toLowerCase();
  for (const node of nodes) {
    if (!node.enabled || !node.clickable) {
      continue;
    }
    if (node.className !== "android.widget.Button") {
      continue;
    }
    if (node.text.trim().toLowerCase() !== normalized) {
      continue;
    }
    if (!isBottomCandidate(node, minCenterY)) {
      continue;
    }
    return node;
  }
  return null;
}

export function activeBottomTabLabel(
  nodes: readonly UiNode[],
  tabLabels: readonly string[],
  minCenterY: number,
): string | null {
  const normalizedLabels = new Set(tabLabels.map((label) => label.trim().toLowerCase()));
  for (const node of nodes) {
    if (!node.enabled || !node.clickable || node.className !== "android.widget.Button") {
      continue;
    }
    if (!isBottomCandidate(node, minCenterY)) {
      continue;
    }
    const normalizedText = node.text.trim().toLowerCase();
    if (!normalizedLabels.has(normalizedText)) {
      continue;
    }
    if (node.focused || node.selected) {
      return node.text;
    }
  }
  return null;
}
