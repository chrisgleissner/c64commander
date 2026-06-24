/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { UiNode } from "../validation/appFirstUi.js";

export type ControlRole =
  | "button"
  | "checkbox"
  | "switch"
  | "select"
  | "segmented"
  | "slider"
  | "text-input"
  | "link"
  | "list-item"
  | "tab"
  | "menu-item"
  | "dialog-action"
  | "unknown";

export interface ControlFingerprintInput {
  route?: string;
  overlay?: string;
  scrollContainerId?: string;
  stableAncestorId?: string;
  siblingIndex?: number;
  role?: ControlRole;
  controlType?: string;
  label?: string;
  accessibilityLabel?: string;
  contentDescription?: string;
  testId?: string;
  resourceId?: string;
  text?: string;
  className?: string;
  enabled?: boolean;
  selected?: boolean;
  checked?: boolean;
  value?: string;
  bounds?: string;
}

const CLASS_ROLE_PATTERNS: ReadonlyArray<readonly [RegExp, ControlRole]> = [
  [/radiobutton/i, "segmented"],
  [/button/i, "button"],
  [/checkbox/i, "checkbox"],
  [/(switch|togglebutton)/i, "switch"],
  [/(seekbar|slider)/i, "slider"],
  [/(edittext|textview.*editable|input)/i, "text-input"],
  [/(spinner|select)/i, "select"],
  [/tab/i, "tab"],
  [/link/i, "link"],
  [/menuitem/i, "menu-item"],
];

export function inferRole(className?: string, fallback?: ControlRole): ControlRole {
  if (className) {
    for (const [pattern, role] of CLASS_ROLE_PATTERNS) {
      if (pattern.test(className)) {
        return role;
      }
    }
  }
  return fallback ?? "unknown";
}

function scopeKey(input: ControlFingerprintInput): string {
  const scope = [input.route ?? "", input.overlay ?? ""];
  if (input.scrollContainerId) {
    scope.push(input.scrollContainerId);
  }
  return scope.join("|");
}

function resolveLabel(input: ControlFingerprintInput): string {
  return (input.label ?? input.accessibilityLabel ?? input.contentDescription ?? input.text ?? "").trim();
}

export function fingerprintKey(input: ControlFingerprintInput): string {
  const scope = scopeKey(input);
  const role = input.role ?? inferRole(input.className);

  if (input.testId) {
    return `tid|${scope}|${input.testId}`;
  }
  if (input.resourceId) {
    return `rid|${scope}|${input.resourceId}`;
  }

  const label = resolveLabel(input);
  if (label) {
    return `lbl|${scope}|${role}|${label.toLowerCase()}`;
  }

  const ancestor = input.stableAncestorId ?? "";
  const sibling = input.siblingIndex ?? -1;
  return `pos|${scope}|${ancestor}|${role}|${sibling}`;
}

export function isPositionalFingerprint(input: ControlFingerprintInput): boolean {
  return fingerprintKey(input).startsWith("pos|");
}

export function dedupeByFingerprint(inputs: readonly ControlFingerprintInput[]): ControlFingerprintInput[] {
  const seen = new Set<string>();
  const result: ControlFingerprintInput[] = [];
  for (const input of inputs) {
    const key = fingerprintKey(input);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(input);
  }
  return result;
}

export function fingerprintFromUiNode(
  node: UiNode,
  options: {
    route?: string;
    overlay?: string;
    scrollContainerId?: string;
    stableAncestorId?: string;
    siblingIndex?: number;
    testId?: string;
  } = {},
): ControlFingerprintInput {
  return {
    route: options.route,
    overlay: options.overlay,
    scrollContainerId: options.scrollContainerId,
    stableAncestorId: options.stableAncestorId,
    siblingIndex: options.siblingIndex,
    testId: options.testId,
    className: node.className,
    resourceId: node.resourceId,
    label: node.text,
    accessibilityLabel: node.contentDesc,
    contentDescription: node.contentDesc,
    text: node.text,
    enabled: node.enabled,
    selected: node.selected,
    checked: node.selected,
    bounds: node.bounds,
    role: inferRole(node.className),
  };
}
