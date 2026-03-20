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

const REST_ROW_ORDER = [
  "Device info",
  "Config reads",
  "Config writes",
  "Drive ops",
  "Machine",
  "Streams",
  "Automation",
  "Diagnostics",
  "Library",
  "Other",
];

const FTP_ROW_ORDER = ["Browse", "Read", "Write", "Manage", "Session", "Other FTP"];

const READ_METHODS = new Set(["GET", "HEAD"]);

const naturalCompare = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true });

const decodeLabelSegment = (value: string): string =>
  decodeURIComponent(value)
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();

const truncateLabel = (value: string, maxLength = 18): string =>
  value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}…` : value;

const sortMatrix = (matrix: HeatMapMatrix, rowOrder?: string[]) => {
  if (rowOrder) {
    matrix.rowGroups.sort((left, right) => {
      const leftIndex = rowOrder.indexOf(left);
      const rightIndex = rowOrder.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return naturalCompare(left, right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  } else {
    matrix.rowGroups.sort(naturalCompare);
  }
  matrix.columnItems.sort(naturalCompare);
  return matrix;
};

const classifyDriveAction = (segments: string[]): string => {
  const action = segments[3] ?? "";
  if (!segments[2]) return "Inventory";
  if (action === "mount") return "Mount";
  if (action === "eject") return "Eject";
  if (action === "attach") return "Attach";
  if (action === "detach") return "Detach";
  if (action === "status") return "Status";
  return "Drive detail";
};

const classifyRestEndpoint = (path: string, method: string): { rowGroup: string; columnItem: string } => {
  const cleanPath = path.split("?")[0];
  const segments = cleanPath.split("/").filter(Boolean);
  const family = segments[1] ?? "";
  const isRead = READ_METHODS.has(method);

  if (family === "info") {
    return { rowGroup: "Device info", columnItem: "Info" };
  }

  if (family === "configs") {
    const category = segments[2];
    return {
      rowGroup: isRead ? "Config reads" : "Config writes",
      columnItem: category ? truncateLabel(decodeLabelSegment(category)) : "Config tree",
    };
  }

  if (family === "drives") {
    return {
      rowGroup: "Drive ops",
      columnItem: classifyDriveAction(segments),
    };
  }

  if (family === "machine") {
    return {
      rowGroup: "Machine",
      columnItem: truncateLabel(decodeLabelSegment(segments[2] ?? "Status")),
    };
  }

  if (family === "streams") {
    return {
      rowGroup: "Streams",
      columnItem: truncateLabel(decodeLabelSegment(segments[2] ?? "Overview")),
    };
  }

  if (family === "runners") {
    return {
      rowGroup: "Automation",
      columnItem: truncateLabel(decodeLabelSegment(segments[3] ?? segments[2] ?? "Overview")),
    };
  }

  if (family === "diagnostics") {
    return {
      rowGroup: "Diagnostics",
      columnItem: truncateLabel(decodeLabelSegment(segments[2] ?? "Overview")),
    };
  }

  if (family === "playlists" || family === "files") {
    return {
      rowGroup: "Library",
      columnItem: truncateLabel(decodeLabelSegment(segments[2] ?? family)),
    };
  }

  return {
    rowGroup: "Other",
    columnItem: truncateLabel(decodeLabelSegment(segments[1] ?? "Other")),
  };
};

// ─── FTP row groups ───────────────────────────────────────────────────────────

const classifyFtpOperation = (op: string): string => {
  const upper = op.toUpperCase();
  if (upper === "LIST" || upper === "NLST" || upper === "MLSD") return "Browse";
  if (upper === "RETR" || upper === "GET" || upper === "READ" || upper === "SIZE" || upper === "MDTM") {
    return "Read";
  }
  if (upper === "STOR" || upper === "PUT" || upper === "WRITE" || upper === "APPE") return "Write";
  if (upper === "DELE" || upper === "RMD" || upper === "MKD" || upper === "RNFR" || upper === "RNTO") {
    return "Manage";
  }
  if (upper === "CWD" || upper === "PWD" || upper === "NOOP" || upper === "TYPE" || upper === "PASV") {
    return "Session";
  }
  return "Other FTP";
};

const classifyFtpTarget = (path: string): string | null => {
  if (!path) return null;
  const lower = path.toLowerCase();
  if (lower === "/") return "Root";
  if (lower.includes("/games")) return "Games";
  if (lower.includes("/demos")) return "Demos";
  if (lower.includes("/config")) return "Config";
  if (lower.includes("/saves")) return "Saves";
  if (lower.includes("/logs")) return "Logs";
  if (lower.endsWith(".d64")) return "Disk";
  if (lower.endsWith(".prg")) return "PRG";
  if (lower.endsWith(".sid")) return "SID";
  if (lower.endsWith(".crt")) return "CRT";
  if (lower.endsWith(".txt")) return "Text";
  if (lower.endsWith(".json")) return "JSON";
  const finalSegment = path.split("/").filter(Boolean).at(-1);
  return finalSegment ? truncateLabel(decodeLabelSegment(finalSegment), 14) : null;
};

const formatFtpColumnLabel = (operation: string, path: string): string => {
  const upper = operation.toUpperCase();
  const target = classifyFtpTarget(path);
  return truncateLabel(target ? `${upper} ${target}` : upper);
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
    const method = typeof e.data.method === "string" ? e.data.method.toUpperCase() : "GET";
    const { rowGroup, columnItem } = classifyRestEndpoint(path, method);
    const colItem = columnItem;
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

    if (method === "GET" || method === "HEAD") cell.readCount++;
    else cell.writeCount++;
  }

  return sortMatrix(matrix, REST_ROW_ORDER);
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
    const path = typeof e.data.path === "string" ? e.data.path : "";
    const rowGroup = classifyFtpOperation(op);
    const colItem = formatFtpColumnLabel(op, path);
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

  return sortMatrix(matrix, FTP_ROW_ORDER);
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

  return sortMatrix(matrix);
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
