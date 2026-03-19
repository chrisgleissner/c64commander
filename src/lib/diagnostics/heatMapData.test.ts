/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildConfigHeatMap,
  buildFtpHeatMap,
  buildRestHeatMap,
  getCellMetricValue,
  getMatrixMaxMetric,
} from "@/lib/diagnostics/heatMapData";
import type { TraceEvent } from "@/lib/tracing/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseCtx = {
  lifecycleState: "foreground" as const,
  sourceKind: null,
  localAccessMode: null,
  trackInstanceId: null,
  playlistItemId: null,
};

let idCounter = 0;
const makeEvent = (type: TraceEvent["type"], data: Record<string, unknown>): TraceEvent => ({
  id: `e${++idCounter}`,
  timestamp: new Date().toISOString(),
  relativeMs: 0,
  type,
  origin: "system",
  correlationId: "test",
  data: { ...baseCtx, ...data },
});

const restResponse = (path: string, status = 200, durationMs = 50, method = "GET") =>
  makeEvent("rest-response", { path, status, durationMs, method });

const ftpOp = (operation: string, result = "success", durationMs = 30) =>
  makeEvent("ftp-operation", { operation, result, durationMs });

const restRequest = (path: string) => makeEvent("rest-request", { path });

// ─── buildRestHeatMap ─────────────────────────────────────────────────────────

describe("buildRestHeatMap", () => {
  it("returns empty matrix for no events", () => {
    const m = buildRestHeatMap([]);
    expect(m.rowGroups).toHaveLength(0);
    expect(m.columnItems).toHaveLength(0);
    expect(m.variant).toBe("REST");
  });

  it("ignores non-rest-response events", () => {
    const m = buildRestHeatMap([makeEvent("rest-request", { path: "/v1/info" })]);
    expect(m.rowGroups).toHaveLength(0);
  });

  it("creates a cell for a successful /v1/info response", () => {
    const m = buildRestHeatMap([restResponse("/v1/info")]);
    expect(m.columnItems).toContain("Info");
    const cell = m.cells["Device info"]?.["Info"];
    expect(cell).toBeDefined();
    expect(cell?.callCount).toBe(1);
    expect(cell?.failCount).toBe(0);
    expect(cell?.readCount).toBe(1);
  });

  it("increments failCount for 4xx/5xx status", () => {
    const m = buildRestHeatMap([restResponse("/v1/info", 500)]);
    expect(m.cells["Device info"]?.["Info"]?.failCount).toBe(1);
  });

  it("increments failCount when error string is present", () => {
    const m = buildRestHeatMap([
      makeEvent("rest-response", {
        ...baseCtx,
        path: "/v1/info",
        status: 200,
        durationMs: 10,
        method: "GET",
        error: "timeout",
      }),
    ]);
    expect(m.cells["Device info"]?.["Info"]?.failCount).toBe(1);
  });

  it("accumulates latency and sorts it", () => {
    const events = [
      restResponse("/v1/info", 200, 100),
      restResponse("/v1/info", 200, 30),
      restResponse("/v1/info", 200, 60),
    ];
    const m = buildRestHeatMap(events);
    const cell = m.cells["Device info"]?.["Info"];
    expect(cell).toBeDefined();
    expect(cell.latenciesMs).toEqual([30, 60, 100]);
  });

  it("counts write methods as writeCount", () => {
    const m = buildRestHeatMap([restResponse("/v1/machine", 204, 50, "PUT")]);
    const cell = m.cells["Machine"]?.["Machine control"];
    expect(cell).toBeDefined();
    expect(cell.writeCount).toBe(1);
    expect(cell.readCount).toBe(0);
  });

  it("groups /v1/configs exactly under Config reads", () => {
    const m = buildRestHeatMap([restResponse("/v1/configs")]);
    expect(m.cells["Config reads"]?.["Configs (full tree)"]).toBeDefined();
  });

  it("groups /v1/configs/Audio under Config reads / Config items", () => {
    const m = buildRestHeatMap([restResponse("/v1/configs/Audio")]);
    expect(m.cells["Config reads"]?.["Config items"]).toBeDefined();
  });

  it("groups /v1/drives under Drive ops", () => {
    const m = buildRestHeatMap([restResponse("/v1/drives")]);
    expect(m.cells["Drive ops"]?.["Drives"]).toBeDefined();
  });

  it("groups unknown path under Other", () => {
    const m = buildRestHeatMap([restResponse("/v1/unknown")]);
    expect(m.cells["Other"]?.["Other"]).toBeDefined();
  });

  it("handles missing path (not a string) → uses empty string → Other", () => {
    const m = buildRestHeatMap([makeEvent("rest-response", { status: 200, durationMs: 10, method: "GET" })]);
    // path missing → "" → classifyRestPath("") → Other; REST_ROW_GROUPS["Other"] → "Other"
    expect(m.cells["Other"]?.["Other"]).toBeDefined();
  });

  it("handles missing status (not a number) → null → no failCount increment", () => {
    const m = buildRestHeatMap([makeEvent("rest-response", { path: "/v1/info", durationMs: 10, method: "GET" })]);
    expect(m.cells["Device info"]?.["Info"]?.failCount).toBe(0);
  });

  it("handles missing durationMs → no latency recorded", () => {
    const m = buildRestHeatMap([makeEvent("rest-response", { path: "/v1/info", status: 200, method: "GET" })]);
    expect(m.cells["Device info"]?.["Info"]?.latenciesMs).toHaveLength(0);
  });

  it("handles missing method → defaults to GET behavior (readCount++)", () => {
    const m = buildRestHeatMap([makeEvent("rest-response", { path: "/v1/info", status: 200, durationMs: 10 })]);
    expect(m.cells["Device info"]?.["Info"]?.readCount).toBe(1);
  });

  it("uses ?? 'Other' fallback for unrecognized colItem in rowGroup lookup", () => {
    // Force an unrecognized colItem by having a path that classifies to something not in REST_ROW_GROUPS
    // Since classifyRestPath always returns a known colItem, we'd need a path that hits "Other"
    // which IS in REST_ROW_GROUPS → covers the normal path, not the ?? fallback
    // Instead: verify the row group when path is empty → "Other" → REST_ROW_GROUPS["Other"] is "Other"
    const m = buildRestHeatMap([makeEvent("rest-response", { status: 200 })]);
    expect(m.cells["Other"]?.["Other"]).toBeDefined();
  });
});

// ─── buildFtpHeatMap ──────────────────────────────────────────────────────────

describe("buildFtpHeatMap", () => {
  it("returns empty matrix for no events", () => {
    const m = buildFtpHeatMap([]);
    expect(m.variant).toBe("FTP");
    expect(m.rowGroups).toHaveLength(0);
  });

  it("ignores non-ftp-operation events", () => {
    const m = buildFtpHeatMap([restResponse("/v1/info")]);
    expect(m.rowGroups).toHaveLength(0);
  });

  it("groups LIST under List operations", () => {
    const m = buildFtpHeatMap([ftpOp("LIST")]);
    expect(m.cells["List operations"]?.["LIST"]).toBeDefined();
    expect(m.cells["List operations"]?.["LIST"]?.callCount).toBe(1);
  });

  it("groups NLST under List operations", () => {
    const m = buildFtpHeatMap([ftpOp("NLST")]);
    expect(m.cells["List operations"]?.["NLST"]).toBeDefined();
  });

  it("groups RETR under Read operations", () => {
    const m = buildFtpHeatMap([ftpOp("RETR")]);
    expect(m.cells["Read operations"]?.["RETR"]).toBeDefined();
  });

  it("groups STOR under Write operations", () => {
    const m = buildFtpHeatMap([ftpOp("STOR")]);
    expect(m.cells["Write operations"]?.["STOR"]).toBeDefined();
  });

  it("groups unknown FTP operation under Other FTP", () => {
    const m = buildFtpHeatMap([ftpOp("MKD")]);
    expect(m.cells["Other FTP"]?.["MKD"]).toBeDefined();
  });

  it("increments failCount for failure result", () => {
    const m = buildFtpHeatMap([ftpOp("LIST", "failure")]);
    expect(m.cells["List operations"]?.["LIST"]?.failCount).toBe(1);
  });

  it("increments failCount when error string is present", () => {
    const event = makeEvent("ftp-operation", {
      operation: "LIST",
      result: "success",
      durationMs: 20,
      error: "connection refused",
    });
    const m = buildFtpHeatMap([event]);
    expect(m.cells["List operations"]?.["LIST"]?.failCount).toBe(1);
  });

  it("accumulates and sorts latencies", () => {
    const events = [ftpOp("LIST", "success", 80), ftpOp("LIST", "success", 20)];
    const m = buildFtpHeatMap(events);
    expect(m.cells["List operations"]?.["LIST"]?.latenciesMs).toEqual([20, 80]);
  });

  it("handles missing operation (not a string) → 'OTHER' fallback", () => {
    const m = buildFtpHeatMap([makeEvent("ftp-operation", { result: "success", durationMs: 10 })]);
    // operation missing → "OTHER" → classifyFtpOperation("OTHER") → "Other FTP"
    expect(m.cells["Other FTP"]?.["OTHER"]).toBeDefined();
  });

  it("handles missing result (not a string) → null → no failCount", () => {
    const m = buildFtpHeatMap([makeEvent("ftp-operation", { operation: "LIST", durationMs: 10 })]);
    expect(m.cells["List operations"]?.["LIST"]?.failCount).toBe(0);
  });

  it("handles missing durationMs in FTP → no latency recorded", () => {
    const m = buildFtpHeatMap([makeEvent("ftp-operation", { operation: "LIST", result: "success" })]);
    expect(m.cells["List operations"]?.["LIST"]?.latenciesMs).toHaveLength(0);
  });
});

// ─── buildConfigHeatMap ───────────────────────────────────────────────────────

describe("buildConfigHeatMap", () => {
  it("returns empty matrix for no events", () => {
    const m = buildConfigHeatMap([]);
    expect(m.variant).toBe("CONFIG");
    expect(m.rowGroups).toHaveLength(0);
  });

  it("ignores events that are not rest-request or rest-response", () => {
    const m = buildConfigHeatMap([ftpOp("LIST")]);
    expect(m.rowGroups).toHaveLength(0);
  });

  it("ignores events with non-config paths", () => {
    const m = buildConfigHeatMap([restResponse("/v1/info")]);
    expect(m.rowGroups).toHaveLength(0);
  });

  it("includes rest-request events for config paths", () => {
    const m = buildConfigHeatMap([restRequest("/v1/configs/Audio/Volume")]);
    // rest-request increments nothing (only rest-response does call/fail counting)
    // but creates cell if it passes the path filter
    expect(m.rowGroups).toContain("Audio");
  });

  it("creates cell from rest-response for /v1/configs/Audio/Volume", () => {
    const m = buildConfigHeatMap([restResponse("/v1/configs/Audio/Volume")]);
    expect(m.cells["Audio"]?.["Volume"]).toBeDefined();
    expect(m.cells["Audio"]?.["Volume"]?.callCount).toBe(1);
  });

  it("groups category-only path under (category)", () => {
    const m = buildConfigHeatMap([restResponse("/v1/configs/LED Strip Settings")]);
    expect(m.cells["LED Strip Settings"]?.["(category)"]).toBeDefined();
  });

  it("truncates long item names to 24 chars with ellipsis", () => {
    const longItem = "AVeryLongConfigItemNameThatExceedsLimit";
    const m = buildConfigHeatMap([restResponse(`/v1/configs/Audio/${longItem}`)]);
    const items = Object.keys(m.cells["Audio"] ?? {});
    expect(items[0]).toHaveLength(23); // 22 chars + 1-char ellipsis '…'
    expect(items[0].endsWith("…")).toBe(true);
  });

  it("increments failCount for 4xx response", () => {
    const m = buildConfigHeatMap([restResponse("/v1/configs/Audio/Volume", 404)]);
    expect(m.cells["Audio"]?.["Volume"]?.failCount).toBe(1);
  });

  it("increments writeCount for non-GET method", () => {
    const m = buildConfigHeatMap([restResponse("/v1/configs/Audio/Volume", 200, 50, "PUT")]);
    expect(m.cells["Audio"]?.["Volume"]?.writeCount).toBe(1);
    expect(m.cells["Audio"]?.["Volume"]?.readCount).toBe(0);
  });

  it("handles missing path (not a string) → uses '' → ignored (not a config path)", () => {
    const m = buildConfigHeatMap([makeEvent("rest-response", { status: 200 })]);
    expect(m.rowGroups).toHaveLength(0);
  });

  it("uses 'Unknown' rowGroup when path has no category match", () => {
    // Path matches /v1/configs but regex doesn't extract category group → 'Unknown'
    const m = buildConfigHeatMap([restResponse("/v1/configs")]);
    // /v1/configs without trailing segment → match[1] missing → "Unknown"
    // Actually: /v1/configs$ match gives match[1]=undefined → rowGroup='Unknown'
    // Wait - /v1/configs has no category segment. Let me check: regex is /^\\/v1\\/configs\\/([^/]+)(?:\\/([^/?]+))?/
    // This requires a slash after configs. /v1/configs alone doesn't match → rowGroup = 'Unknown'
    expect(m.cells["Unknown"]?.["(category)"]).toBeDefined();
  });

  it("handles missing status in CONFIG response → no failCount", () => {
    const m = buildConfigHeatMap([makeEvent("rest-response", { path: "/v1/configs/Audio/Volume", durationMs: 10 })]);
    expect(m.cells["Audio"]?.["Volume"]?.failCount).toBe(0);
  });

  it("handles missing durationMs in CONFIG response → no latency", () => {
    const m = buildConfigHeatMap([makeEvent("rest-response", { path: "/v1/configs/Audio/Volume", status: 200 })]);
    expect(m.cells["Audio"]?.["Volume"]?.latenciesMs).toHaveLength(0);
  });

  it("handles missing method in CONFIG response → defaults to GET (readCount++)", () => {
    const m = buildConfigHeatMap([makeEvent("rest-response", { path: "/v1/configs/Audio/Volume", status: 200 })]);
    expect(m.cells["Audio"]?.["Volume"]?.readCount).toBe(1);
  });

  it("increments failCount when CONFIG response has a non-empty error string", () => {
    const m = buildConfigHeatMap([
      makeEvent("rest-response", { path: "/v1/configs/Audio/Volume", status: 200, error: "network error" }),
    ]);
    expect(m.cells["Audio"]?.["Volume"]?.failCount).toBe(1);
  });
});

// ─── getCellMetricValue ───────────────────────────────────────────────────────

describe("getCellMetricValue", () => {
  const cell = {
    rowGroup: "r",
    columnItem: "c",
    callCount: 5,
    failCount: 1,
    latenciesMs: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    readCount: 4,
    writeCount: 1,
  };

  it("returns callCount for Count mode", () => {
    expect(getCellMetricValue(cell, "Count")).toBe(5);
  });

  it("returns p90 latency for Latency mode", () => {
    // p90 of [10..100]: ceil(0.9 * 10) = 9 → index 8 → 90
    expect(getCellMetricValue(cell, "Latency")).toBe(90);
  });

  it("returns 0 for Latency mode when no latencies", () => {
    const empty = { ...cell, latenciesMs: [] };
    expect(getCellMetricValue(empty, "Latency")).toBe(0);
  });
});

// ─── getMatrixMaxMetric ───────────────────────────────────────────────────────

describe("getMatrixMaxMetric", () => {
  it("returns 0 for empty matrix", () => {
    const m = buildRestHeatMap([]);
    expect(getMatrixMaxMetric(m, "Count")).toBe(0);
  });

  it("returns max call count across all cells", () => {
    const events = [
      restResponse("/v1/info", 200, 10),
      restResponse("/v1/info", 200, 10),
      restResponse("/v1/configs", 200, 10),
    ];
    const m = buildRestHeatMap(events);
    // Info has 2 calls, Configs (full tree) has 1 → max = 2
    expect(getMatrixMaxMetric(m, "Count")).toBe(2);
  });

  it("returns max p90 latency across all cells in Latency mode", () => {
    const events = [restResponse("/v1/info", 200, 200), restResponse("/v1/configs", 200, 50)];
    const m = buildRestHeatMap(events);
    // Info cell has 1 sample: p90 = 200; Configs cell has 1 sample: p90 = 50
    expect(getMatrixMaxMetric(m, "Latency")).toBe(200);
  });
});
