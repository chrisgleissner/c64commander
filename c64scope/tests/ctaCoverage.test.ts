/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { summarizeCoverage, toCoverageCsv, toCoverageJson } from "../src/cta/coverage.js";
import type { CtaCoverageRecord } from "../src/cta/coverage.js";

function record(overrides: Partial<CtaCoverageRecord>): CtaCoverageRecord {
  return {
    ctaId: "F003.C01",
    featureId: "F003",
    route: "/",
    label: "Reset",
    status: "PASS",
    inputMethod: "keypad",
    ...overrides,
  };
}

describe("summarizeCoverage", () => {
  it("counts total and passed records, treating only PASS as passed", () => {
    const records = [
      record({ ctaId: "a", status: "PASS" }),
      record({ ctaId: "b", status: "FAIL" }),
      record({ ctaId: "c", status: "BLOCKED" }),
      record({ ctaId: "d", status: "INCONCLUSIVE" }),
    ];
    const summary = summarizeCoverage(records);
    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(1);
  });

  it("aggregates by status and input method", () => {
    const records = [
      record({ ctaId: "a", status: "PASS", inputMethod: "keypad" }),
      record({ ctaId: "b", status: "PASS", inputMethod: "touch" }),
      record({ ctaId: "c", status: "FAIL", inputMethod: "keypad" }),
    ];
    const summary = summarizeCoverage(records);
    expect(summary.byStatus["PASS"]).toBe(2);
    expect(summary.byStatus["FAIL"]).toBe(1);
    expect(summary.byInputMethod["keypad"]).toBe(2);
    expect(summary.byInputMethod["touch"]).toBe(1);
  });

  it("aggregates per route and per feature with passed counts", () => {
    const records = [
      record({ ctaId: "a", featureId: "F003", route: "/", status: "PASS" }),
      record({ ctaId: "b", featureId: "F003", route: "/", status: "FAIL" }),
      record({ ctaId: "c", featureId: "F010", route: "/play", status: "PASS" }),
    ];
    const summary = summarizeCoverage(records);
    expect(summary.byFeature["F003"]).toEqual({ total: 2, passed: 1 });
    expect(summary.byFeature["F010"]).toEqual({ total: 1, passed: 1 });
    expect(summary.byRoute["/"]).toEqual({ total: 2, passed: 1 });
    expect(summary.byRoute["/play"]).toEqual({ total: 1, passed: 1 });
  });

  it("reports zero counts for an empty record set", () => {
    const summary = summarizeCoverage([]);
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.byStatus["PASS"]).toBe(0);
  });
});

describe("toCoverageCsv", () => {
  it("emits a header row and one row per record", () => {
    const csv = toCoverageCsv([
      record({ ctaId: "F003.C01", label: "Reset", notes: undefined }),
      record({ ctaId: "F003.C02", label: "Reboot", status: "FAIL" }),
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("ctaId,featureId,route,label,status,inputMethod,runId,notes");
    expect(lines).toHaveLength(3);
    expect(lines[1]!.startsWith("F003.C01,")).toBe(true);
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = toCoverageCsv([record({ ctaId: "x", notes: 'has, comma and "quote"' })]);
    const notesCell = csv.split("\n")[1]!.split(",").slice(7).join(",");
    expect(notesCell.startsWith('"')).toBe(true);
    expect(notesCell.endsWith('"')).toBe(true);
  });
});

describe("toCoverageJson", () => {
  it("wraps records with a generatedAt timestamp and summary", () => {
    const records = [record({ ctaId: "a", status: "PASS" })];
    const payload = toCoverageJson(records, summarizeCoverage(records)) as {
      generatedAt: string;
      summary: { passed: number };
      records: CtaCoverageRecord[];
    };
    expect(typeof payload.generatedAt).toBe("string");
    expect(payload.summary.passed).toBe(1);
    expect(payload.records).toHaveLength(1);
  });
});
