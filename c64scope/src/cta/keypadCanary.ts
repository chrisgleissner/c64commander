/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type KeypadCanaryStatus = "PASS" | "FAIL";
export type KeypadCanaryStepKind =
  | "tab-shortcut"
  | "overlay-shortcut"
  | "dpad-traversal"
  | "keypad-activation"
  | "touch-activation";

export interface KeypadCanaryStep {
  id: string;
  kind: KeypadCanaryStepKind;
  keyName: string;
  keyCode?: number;
  tap?: {
    x: number;
    y: number;
  };
  expectedText: string[];
  cleanupKeyCode?: number;
}

export interface KeypadCanaryStepResult {
  id: string;
  kind: KeypadCanaryStepKind;
  keyName: string;
  keyCode?: number;
  tap?: {
    x: number;
    y: number;
  };
  status: KeypadCanaryStatus;
  expectedText: string[];
  missingText: string[];
  evidence: {
    screenshot: string;
    hierarchy: string;
  };
  cleanupKeyCode?: number;
}

export interface KeypadCanarySummary {
  total: number;
  passed: number;
  failed: number;
  status: KeypadCanaryStatus;
}

export const KEYCODES = {
  BACK: 4,
  KEY_1: 8,
  KEY_2: 9,
  KEY_3: 10,
  KEY_4: 11,
  KEY_5: 12,
  KEY_6: 13,
  STAR: 17,
  POUND: 18,
  DPAD_DOWN: 20,
  DPAD_CENTER: 23,
} as const;

export const TAB_CANARY_STEPS: readonly KeypadCanaryStep[] = [
  {
    id: "digit-1-home",
    kind: "tab-shortcut",
    keyName: "1",
    keyCode: KEYCODES.KEY_1,
    expectedText: ["Home", "Quick Actions"],
  },
  {
    id: "digit-2-play",
    kind: "tab-shortcut",
    keyName: "2",
    keyCode: KEYCODES.KEY_2,
    expectedText: ["Play Files", "Select a playlist item to start", "Playlist"],
  },
  {
    id: "digit-3-disks",
    kind: "tab-shortcut",
    keyName: "3",
    keyCode: KEYCODES.KEY_3,
    expectedText: ["Disks"],
  },
  {
    id: "digit-4-config",
    kind: "tab-shortcut",
    keyName: "4",
    keyCode: KEYCODES.KEY_4,
    expectedText: ["Config"],
  },
  {
    id: "digit-5-settings",
    kind: "tab-shortcut",
    keyName: "5",
    keyCode: KEYCODES.KEY_5,
    expectedText: ["Settings", "Connection"],
  },
  {
    id: "digit-6-docs",
    kind: "tab-shortcut",
    keyName: "6",
    keyCode: KEYCODES.KEY_6,
    expectedText: ["Docs", "Getting Started", "External Resources"],
  },
];

export const SHORTCUT_CANARY_STEPS: readonly KeypadCanaryStep[] = [
  {
    id: "star-diagnostics",
    kind: "overlay-shortcut",
    keyName: "Star",
    keyCode: KEYCODES.STAR,
    expectedText: ["Diagnostics"],
    cleanupKeyCode: KEYCODES.BACK,
  },
  {
    id: "pound-switch-device",
    kind: "overlay-shortcut",
    keyName: "Pound",
    keyCode: KEYCODES.POUND,
    expectedText: ["Switch Device"],
    cleanupKeyCode: KEYCODES.BACK,
  },
];

export const DPAD_CANARY_STEPS: readonly KeypadCanaryStep[] = [
  {
    id: "dpad-down-docs-reachable",
    kind: "dpad-traversal",
    keyName: "D-pad Down",
    keyCode: KEYCODES.DPAD_DOWN,
    expectedText: ["Docs", "Getting Started"],
  },
  {
    id: "dpad-center-docs-activatable",
    kind: "keypad-activation",
    keyName: "D-pad Center",
    keyCode: KEYCODES.DPAD_CENTER,
    expectedText: ["Play Files", "Playlist"],
  },
];

export const TOUCH_CANARY_STEPS: readonly KeypadCanaryStep[] = [
  {
    id: "touch-docs-getting-started-activatable",
    kind: "touch-activation",
    keyName: "Touch",
    tap: { x: 539, y: 380 },
    expectedText: ["Connect in 4 steps:", "Save & Connect"],
  },
];

function normalizeHierarchyText(hierarchy: string): string {
  return hierarchy
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function missingExpectedText(hierarchy: string, expectedText: readonly string[]): string[] {
  const normalized = normalizeHierarchyText(hierarchy);
  return expectedText.filter((text) => !normalized.includes(text.toLowerCase()));
}

export function buildKeypadCanaryResult(
  step: KeypadCanaryStep,
  hierarchy: string,
  evidence: KeypadCanaryStepResult["evidence"],
): KeypadCanaryStepResult {
  const missingText = missingExpectedText(hierarchy, step.expectedText);
  return {
    id: step.id,
    kind: step.kind,
    keyName: step.keyName,
    keyCode: step.keyCode,
    tap: step.tap,
    status: missingText.length === 0 ? "PASS" : "FAIL",
    expectedText: [...step.expectedText],
    missingText,
    evidence,
    cleanupKeyCode: step.cleanupKeyCode,
  };
}

export function summarizeKeypadCanary(results: readonly KeypadCanaryStepResult[]): KeypadCanarySummary {
  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.length - passed;
  return {
    total: results.length,
    passed,
    failed,
    status: failed === 0 ? "PASS" : "FAIL",
  };
}
