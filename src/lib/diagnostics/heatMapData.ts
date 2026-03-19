/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §15.2–15.8 — Shared heat map data model for REST, FTP, and CONFIG activity.
// The model supports both count and latency (p90) metric modes.

import type { TraceEvent } from "@/lib/tracing/types";

export type HeatMapVariant = "REST" | "FTP" | "CONFIG";
export type HeatMapMetricMode = "Count" | "Latency";

/** A cell in the heat map matrix: one row-group × one column-item intersection. */
export type HeatMapCell = {
  rowGroup: string;
  columnItem: string;
  callCount: number;
  failCount: number;
  /** All recorded latencies in ms, sorted ascending */
  latenciesMs: number[];
  readCount: number;
  writeCount: number;
};

export type HeatMapMatrix = {
  variant: HeatMapVariant;
  rowGroups: string[];
  columnItems: string[];
  cells: Record<string, Record<string, HeatMapCell>>;
  computedAt: string;
};

// ─── REST row groups and column classification ────────────────────────────────

const REST_ROW_GROUPS: Record<string, string> = {
  Info: "Device info",
  "Configs (full tree)": "Config reads",
  "Config items": "Config reads",
  Drives: "Drive ops",
  "Machine control": "Machine",
  Other: "Other",
};

const classifyRestPath = (path: string): string => {
  if (/^\/v1\/info\b/.test(path)) return "Info";
  if (/^\/v1\/configs$/.test(path)) return "Configs (full tree)";
  if (/^\/v1\/configs\//.test(path)) return "Config items";
  if (/^\/v1\/drives\b/.test(path)) return "Drives";
  if (/^\/v1\/(machine|runners|streams)\b/.test(path)) return "Machine control";
  return "Other";
};

// ─── FTP row groups ───────────────────────────────────────────────────────────

const classifyFtpOperation = (op: string): string => {
  const upper = op.toUpperCase();
  if (upper === "LIST" || upper === "NLST") return "List operations";
  if (upper === "RETR" || upper === "GET" || upper === "READ") return "Read operations";
  if (upper === "STOR" || upper === "PUT" || upper === "WRITE") return "Write operations";
  return "Other FTP";
};

// ─── CONFIG row groups ────────────────────────────────────────────────────────

const truncateConfigItem = (s: string): string => (s.length > 24 ? s.slice(0, 22) + "…" : s);

// ─── Matrix builder ───────────────────────────────────────────────────────────

const ensureCell = (matrix: HeatMapMatrix, rowGroup: string, colItem: string): HeatMapCell => {
  if (!matrix.cells[rowGroup]) matrix.cells[rowGroup] = {};
  if (!matrix.cells[rowGroup][colItem]) {
    matrix.cells[rowGroup][colItem] = {
      rowGroup,
      columnItem: colItem,
      callCount: 0,
      failCount: 0,
      latenciesMs: [],
      readCount: 0,
      writeCount: 0,
    };
    if (!matrix.rowGroups.includes(rowGroup)) matrix.rowGroups.push(rowGroup);
    if (!matrix.columnItems.includes(colItem)) matrix.columnItems.push(colItem);
  }
  return matrix.cells[rowGroup][colItem];
};

export const buildRestHeatMap = (events: TraceEvent[]): HeatMapMatrix => {
  const matrix: HeatMapMatrix = {
    variant: "REST",
    rowGroups: [],
    columnItems: [],
    cells: {},
    computedAt: new Date().toISOString(),
  };

  for (const e of events) {
    if (e.type !== "rest-response") continue;
    const path = typeof e.data.path === "string" ? e.data.path : "";
    const colItem = classifyRestPath(path);
    const rowGroup = REST_ROW_GROUPS[colItem] ?? "Other";
    const cell = ensureCell(matrix, rowGroup, colItem);
    cell.callCount++;

    const status = typeof e.data.status === "number" ? e.data.status : null;
    const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
    if ((status !== null && status >= 400) || hasError) cell.failCount++;

    const duration = typeof e.data.durationMs === "number" ? e.data.durationMs : null;
    if (duration !== null) {
      cell.latenciesMs.push(duration);
      cell.latenciesMs.sort((a, b) => a - b);
    }

    const method = typeof e.data.method === "string" ? e.data.method.toUpperCase() : "GET";
    if (method === "GET" || method === "HEAD") cell.readCount++;
    else cell.writeCount++;
  }

  return matrix;
};

export const buildFtpHeatMap = (events: TraceEvent[]): HeatMapMatrix => {
  const matrix: HeatMapMatrix = {
    variant: "FTP",
    rowGroups: [],
    columnItems: [],
    cells: {},
    computedAt: new Date().toISOString(),
  };

  for (const e of events) {
    if (e.type !== "ftp-operation") continue;
    const op = typeof e.data.operation === "string" ? e.data.operation : "OTHER";
    const rowGroup = classifyFtpOperation(op);
    const colItem = op.toUpperCase().slice(0, 12);
    const cell = ensureCell(matrix, rowGroup, colItem);
    cell.callCount++;

    const result = typeof e.data.result === "string" ? e.data.result : null;
    const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
    if (result === "failure" || hasError) cell.failCount++;

    const duration = typeof e.data.durationMs === "number" ? e.data.durationMs : null;
    if (duration !== null) {
      cell.latenciesMs.push(duration);
      cell.latenciesMs.sort((a, b) => a - b);
    }
  }

  return matrix;
};

export const buildConfigHeatMap = (events: TraceEvent[]): HeatMapMatrix => {
  const matrix: HeatMapMatrix = {
    variant: "CONFIG",
    rowGroups: [],
    columnItems: [],
    cells: {},
    computedAt: new Date().toISOString(),
  };

  for (const e of events) {
    if (e.type !== "rest-request" && e.type !== "rest-response") continue;
    const path = typeof e.data.path === "string" ? e.data.path : "";
    if (!/^\/v1\/configs/.test(path)) continue;

    // Extract category and item from path /v1/configs/<cat>/<item>
    const match = /^\/v1\/configs\/([^/]+)(?:\/([^/?]+))?/.exec(path);
    const rowGroup = match ? decodeURIComponent(match[1]) : "Unknown";
    const colItem = match?.[2] ? truncateConfigItem(decodeURIComponent(match[2])) : "(category)";
    const cell = ensureCell(matrix, rowGroup, colItem);

    if (e.type === "rest-response") {
      cell.callCount++;

      const status = typeof e.data.status === "number" ? e.data.status : null;
      const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
      if ((status !== null && status >= 400) || hasError) cell.failCount++;

      const duration = typeof e.data.durationMs === "number" ? e.data.durationMs : null;
      if (duration !== null) {
        cell.latenciesMs.push(duration);
        cell.latenciesMs.sort((a, b) => a - b);
      }

      const method = typeof e.data.method === "string" ? e.data.method.toUpperCase() : "GET";
      if (method === "GET") cell.readCount++;
      else cell.writeCount++;
    }
  }

  return matrix;
};

/** Compute the cell metric value given the mode. */
export const getCellMetricValue = (cell: HeatMapCell, mode: HeatMapMetricMode): number => {
  if (mode === "Count") return cell.callCount;
  // Latency mode: p90
  const sorted = cell.latenciesMs;
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(0.9 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
};

/** Compute max metric value across all cells in a matrix (for color normalization). */
export const getMatrixMaxMetric = (matrix: HeatMapMatrix, mode: HeatMapMetricMode): number => {
  let max = 0;
  for (const row of Object.values(matrix.cells)) {
    for (const cell of Object.values(row)) {
      const v = getCellMetricValue(cell, mode);
      if (v > max) max = v;
    }
  }
  return max;
};
