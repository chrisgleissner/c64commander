/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CtaResultStatus } from "./riskModel.js";

// ---------------------------------------------------------------------------
// Per-CTA coverage accounting (Section 6.3, item 5)
//
// The existing harness accounts coverage per-case/per-feature only. This module
// adds per-CTA accounting: every discovered control maps to exactly one
// F-feature and receives an individual result. Aggregation produces the counts
// the final report requires, and serialization emits coverage.csv + coverage.json.
// ---------------------------------------------------------------------------

export type CtaInputMethod = "keypad" | "touch" | "both" | "none";

export interface CtaCoverageRecord {
  ctaId: string;
  featureId: string;
  route: string;
  label: string;
  status: CtaResultStatus;
  inputMethod: CtaInputMethod;
  runId?: string;
  notes?: string;
}

export interface FeatureCoverage {
  total: number;
  passed: number;
}

export interface CoverageSummary {
  total: number;
  passed: number;
  byStatus: Record<CtaResultStatus, number>;
  byInputMethod: Record<CtaInputMethod, number>;
  byRoute: Record<string, FeatureCoverage>;
  byFeature: Record<string, FeatureCoverage>;
}

const ALL_STATUSES: readonly CtaResultStatus[] = [
  "PASS",
  "FAIL",
  "BLOCKED",
  "INCONCLUSIVE",
  "NOT_PRESENT",
  "SPEC_GAP",
  "UNCLASSIFIED",
  "CALIBRATION_ONLY",
];

const ALL_INPUT_METHODS: readonly CtaInputMethod[] = ["keypad", "touch", "both", "none"];

function emptyStatusCounts(): Record<CtaResultStatus, number> {
  const record = {} as Record<CtaResultStatus, number>;
  for (const status of ALL_STATUSES) {
    record[status] = 0;
  }
  return record;
}

function emptyInputCounts(): Record<CtaInputMethod, number> {
  const record = {} as Record<CtaInputMethod, number>;
  for (const method of ALL_INPUT_METHODS) {
    record[method] = 0;
  }
  return record;
}

function bumpFeature(map: Record<string, FeatureCoverage>, key: string, passed: boolean): void {
  const entry = map[key] ?? { total: 0, passed: 0 };
  entry.total += 1;
  if (passed) {
    entry.passed += 1;
  }
  map[key] = entry;
}

export function summarizeCoverage(records: readonly CtaCoverageRecord[]): CoverageSummary {
  const byStatus = emptyStatusCounts();
  const byInputMethod = emptyInputCounts();
  const byRoute: Record<string, FeatureCoverage> = {};
  const byFeature: Record<string, FeatureCoverage> = {};
  let passed = 0;

  for (const record of records) {
    byStatus[record.status] += 1;
    byInputMethod[record.inputMethod] += 1;
    const isPassed = record.status === "PASS";
    if (isPassed) {
      passed += 1;
    }
    bumpFeature(byRoute, record.route, isPassed);
    bumpFeature(byFeature, record.featureId, isPassed);
  }

  return {
    total: records.length,
    passed,
    byStatus,
    byInputMethod,
    byRoute,
    byFeature,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const COLUMNS: readonly (keyof CtaCoverageRecord)[] = [
  "ctaId",
  "featureId",
  "route",
  "label",
  "status",
  "inputMethod",
  "runId",
  "notes",
];

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll(/"/g, '""')}"`;
  }
  return value;
}

export function toCoverageCsv(records: readonly CtaCoverageRecord[]): string {
  const header = COLUMNS.join(",");
  const rows = records.map((record) => COLUMNS.map((column) => escapeCsvField(String(record[column] ?? ""))).join(","));
  return [header, ...rows].join("\n");
}

export function toCoverageJson(records: readonly CtaCoverageRecord[], summary: CoverageSummary): unknown {
  return {
    generatedAt: new Date().toISOString(),
    summary,
    records,
  };
}
