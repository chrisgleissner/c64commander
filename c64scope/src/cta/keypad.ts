/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type KeypadCoverageStatus = "DISCOVERED" | "KEYPAD_REACHABLE" | "KEYPAD_ACTIVATABLE" | "TOUCH_ACTIVATABLE";

export interface KeypadCoverageRecord {
  fingerprint: string;
  statuses: KeypadCoverageStatus[];
  lastKeyCode?: number;
  notes?: string[];
}

export interface KeypadCoverageSummary {
  discovered: number;
  keypadReachable: number;
  keypadActivatable: number;
  touchActivatable: number;
  keypadOnlyGaps: string[];
  touchOnlyGaps: string[];
}

const STATUS_ORDER: Record<KeypadCoverageStatus, number> = {
  DISCOVERED: 0,
  KEYPAD_REACHABLE: 1,
  KEYPAD_ACTIVATABLE: 2,
  TOUCH_ACTIVATABLE: 3,
};

export function normalizeKeypadStatuses(statuses: readonly KeypadCoverageStatus[]): KeypadCoverageStatus[] {
  return [...new Set(statuses)].sort((left, right) => STATUS_ORDER[left] - STATUS_ORDER[right]);
}

export function recordKeypadStatus(
  record: KeypadCoverageRecord,
  status: KeypadCoverageStatus,
  options: { keyCode?: number; note?: string } = {},
): KeypadCoverageRecord {
  return {
    fingerprint: record.fingerprint,
    statuses: normalizeKeypadStatuses([...record.statuses, status]),
    lastKeyCode: options.keyCode ?? record.lastKeyCode,
    notes: options.note ? [...(record.notes ?? []), options.note] : record.notes,
  };
}

export function summarizeKeypadCoverage(records: readonly KeypadCoverageRecord[]): KeypadCoverageSummary {
  const has = (record: KeypadCoverageRecord, status: KeypadCoverageStatus) => record.statuses.includes(status);
  return {
    discovered: records.filter((record) => has(record, "DISCOVERED")).length,
    keypadReachable: records.filter((record) => has(record, "KEYPAD_REACHABLE")).length,
    keypadActivatable: records.filter((record) => has(record, "KEYPAD_ACTIVATABLE")).length,
    touchActivatable: records.filter((record) => has(record, "TOUCH_ACTIVATABLE")).length,
    keypadOnlyGaps: records
      .filter((record) => has(record, "TOUCH_ACTIVATABLE") && !has(record, "KEYPAD_ACTIVATABLE"))
      .map((record) => record.fingerprint),
    touchOnlyGaps: records
      .filter((record) => has(record, "KEYPAD_ACTIVATABLE") && !has(record, "TOUCH_ACTIVATABLE"))
      .map((record) => record.fingerprint),
  };
}
