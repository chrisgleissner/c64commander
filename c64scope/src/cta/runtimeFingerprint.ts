/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { parseBoundsRect, parseUiNodes, type UiNode } from "../validation/appFirstUi.js";
import { fingerprintFromUiNode, fingerprintKey, inferRole, type ControlFingerprintInput } from "./fingerprint.js";

export interface RuntimeFingerprintOptions {
  route?: string;
  overlay?: string;
  scrollContainerId?: string;
  targetPackage?: string;
}

const TEST_ID_PATTERNS: readonly RegExp[] = [
  /(?:data-testid|testid|test-id)=["']?([A-Za-z0-9_.:-]+)/i,
  /\btestid:([A-Za-z0-9_.:-]+)/i,
];

function extractTestId(node: UiNode): string | undefined {
  const candidates = [node.contentDesc, node.resourceId, node.text];
  for (const candidate of candidates) {
    for (const pattern of TEST_ID_PATTERNS) {
      const match = candidate.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
  }
  return undefined;
}

function hasUsableBounds(node: UiNode): boolean {
  return parseBoundsRect(node.bounds) !== null;
}

function isRuntimeControl(node: UiNode, targetPackage?: string): boolean {
  if (targetPackage && node.packageName && node.packageName !== targetPackage) {
    return false;
  }
  if (!node.enabled || !hasUsableBounds(node)) {
    return false;
  }
  return node.clickable || inferRole(node.className) !== "unknown" || Boolean(extractTestId(node));
}

export function fingerprintsFromUiNodes(
  nodes: readonly UiNode[],
  options: RuntimeFingerprintOptions = {},
): ControlFingerprintInput[] {
  return nodes
    .filter((node) => isRuntimeControl(node, options.targetPackage))
    .map((node, index) =>
      fingerprintFromUiNode(node, {
        route: options.route,
        overlay: options.overlay,
        scrollContainerId: options.scrollContainerId,
        siblingIndex: index,
        testId: extractTestId(node),
      }),
    );
}

export function fingerprintKeysFromHierarchy(xml: string, options: RuntimeFingerprintOptions = {}): string[] {
  return fingerprintsFromUiNodes(parseUiNodes(xml), options).map((input) => fingerprintKey(input));
}
