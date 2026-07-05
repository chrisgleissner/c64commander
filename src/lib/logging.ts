/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import { redactExportValue, redactExportText } from "@/lib/diagnostics/exportRedaction";
import { formatLocalTime } from "@/lib/diagnostics/timeFormat";
import { shouldSuppressDiagnosticsSideEffects } from "@/lib/diagnostics/diagnosticsOverlayState";
import { toDiagnosticsDeviceAttribution, type DiagnosticsDeviceAttribution } from "@/lib/diagnostics/deviceAttribution";
import { getTraceContextSnapshot } from "@/lib/tracing/traceContext";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  details?: unknown;
  device?: DiagnosticsDeviceAttribution | null;
};

const MAX_STACK_LINES = 30;
const MAX_STACK_CHARS = 3000;

const LOG_KEY = "c64u_app_logs";
const MAX_LOGS = 500;
const LOG_WRITE_DEBOUNCE_MS = 500;
let externalLogs: LogEntry[] = [];

// In-memory cache of persisted logs, populated lazily from localStorage on
// first access and kept in sync by addLog. Reads never re-parse the full
// blob, and writes are debounced (see scheduleLogPersist), avoiding O(store)
// JSON.parse/stringify work on every single log line. See HARD9-020.
let cachedLogs: LogEntry[] | null = null;
// window.setTimeout returns a number (unlike Node's setTimeout, which
// returns a Timeout object) - typed explicitly since this module runs in a
// browser/WebView context.
let pendingPersistTimer: number | null = null;

// True only for the synchronous span of a "c64u-logs-updated" dispatch that
// WE trigger. Our own listener uses it to tell an internal log write (cache
// already updated by addLog/writeLogs - keep HARD9-020's parse-free hot path)
// apart from an EXTERNAL rewrite of the persisted logs (a test seeding
// c64u_app_logs, or any future out-of-band writer) that dispatches the same
// event and must invalidate the now-stale cache so the next read re-parses.
let dispatchingOwnLogsUpdate = false;

const dispatchLogsUpdated = () => {
  if (typeof window === "undefined") return;
  dispatchingOwnLogsUpdate = true;
  try {
    window.dispatchEvent(new CustomEvent("c64u-logs-updated"));
  } finally {
    dispatchingOwnLogsUpdate = false;
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("c64u-logs-updated", () => {
    if (dispatchingOwnLogsUpdate) return;
    // An external actor rewrote persisted logs underneath us; drop the cache
    // so the next read re-parses localStorage. addLog-driven updates skip this
    // branch (they already updated the cache), so the log hot path stays
    // parse-free. Restores the pre-HARD9-020 "write localStorage + dispatch
    // event => app re-reads" contract that the diagnostics overlay and E2E
    // log-seeding helpers rely on.
    cachedLogs = null;
  });
}

const buildId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
  `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/**
 * Sanitizes log details into a plain, JSON-safe value at capture time (not
 * just before a localStorage write). A circular reference or otherwise
 * unserializable value (e.g. `addErrorLog("Unhandled promise rejection", {
 * reason: event.reason })` with a circular reason) would otherwise throw
 * inside JSON.stringify wherever an entry's details are later serialized -
 * localStorage persistence, formatLogsForShare, etc. See HARD9-020.
 */
const safeSerializeDetails = (details: unknown): unknown => {
  if (details === undefined) return undefined;
  try {
    const seen = new WeakSet<object>();
    return JSON.parse(
      JSON.stringify(details, (_key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      }),
    );
  } catch (error) {
    return { serializationError: error instanceof Error ? error.message : String(error) };
  }
};

const readLogsFromStorage = (): LogEntry[] => {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LogEntry[];
  } catch (error) {
    console.warn("Failed to parse stored logs", { error });
    return [];
  }
};

const readLogs = (): LogEntry[] => {
  if (cachedLogs === null) {
    cachedLogs = readLogsFromStorage();
  }
  return cachedLogs;
};

const persistLogsNow = (logs: LogEntry[]) => {
  if (typeof localStorage === "undefined") return;
  const bounded = logs.slice(0, MAX_LOGS);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(bounded));
  } catch (error) {
    // Most likely a quota-exceeded error. Halve the log count and retry
    // once instead of throwing back into the caller - addLog is reached
    // from a patched console.warn/console.error, so an uncaught throw here
    // would make any app code calling console.warn fail unexpectedly.
    try {
      const halved = bounded.slice(0, Math.floor(bounded.length / 2));
      localStorage.setItem(LOG_KEY, JSON.stringify(halved));
      cachedLogs = halved;
    } catch (retryError) {
      console.warn("Failed to persist logs to localStorage", { error, retryError });
    }
  }
};

// Uses the global setTimeout/clearTimeout rather than window.setTimeout:
// some test environments provide a minimal window mock (dispatchEvent only,
// no timer methods) even though addLog's own guard only checks that window
// exists, not that it has a full timer API. The global functions are
// available in every environment this module runs in (browser, WebView,
// Node-based tests).
const scheduleLogPersist = () => {
  if (pendingPersistTimer !== null) {
    clearTimeout(pendingPersistTimer);
  }
  pendingPersistTimer = setTimeout(() => {
    pendingPersistTimer = null;
    persistLogsNow(cachedLogs ?? []);
  }, LOG_WRITE_DEBOUNCE_MS) as unknown as number;
};

const writeLogs = (logs: LogEntry[]) => {
  cachedLogs = logs.slice(0, MAX_LOGS);
  if (pendingPersistTimer !== null) {
    clearTimeout(pendingPersistTimer);
    pendingPersistTimer = null;
  }
  persistLogsNow(cachedLogs);
};

export const addLog = (level: LogLevel, message: string, details?: unknown) => {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  if (shouldSuppressDiagnosticsSideEffects() && level !== "error") return;
  if (level === "debug" && !loadDebugLoggingEnabled()) return;
  const entry: LogEntry = {
    id: buildId(),
    level,
    message,
    timestamp: new Date().toISOString(),
    details: safeSerializeDetails(details),
    device: toDiagnosticsDeviceAttribution(getTraceContextSnapshot().device),
  };
  cachedLogs = [entry, ...readLogs()].slice(0, MAX_LOGS);
  scheduleLogPersist();
  dispatchLogsUpdated();
};

export const addErrorLog = (message: string, details?: unknown) => {
  addLog("error", message, details);
};

const trimStack = (stack?: string | null) => {
  if (!stack) return null;
  let lines = stack.split("\n");
  if (lines.length > MAX_STACK_LINES) {
    lines = [...lines.slice(0, MAX_STACK_LINES), "... (stack truncated)"];
  }
  let result = lines.join("\n");
  if (result.length > MAX_STACK_CHARS) {
    result = `${result.slice(0, MAX_STACK_CHARS)}... (stack truncated)`;
  }
  return result;
};

export const buildErrorLogDetails = (error: Error, details: Record<string, unknown> = {}) => ({
  ...details,
  error: {
    name: error.name,
    message: typeof details.error === "string" ? details.error : error.message,
    stack: trimStack(error.stack),
  },
  errorName: error.name,
  errorStack: trimStack(error.stack),
});

export const setExternalLogs = (logs: LogEntry[]) => {
  if (typeof window === "undefined") return;
  externalLogs = logs;
  dispatchLogsUpdated();
};

const mergeLogs = () => {
  const merged = [...externalLogs, ...readLogs()];
  const seen = new Set<string>();
  const deduped: LogEntry[] = [];
  for (const entry of merged) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    deduped.push(entry);
  }
  deduped.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  return deduped;
};

export const getLogs = (): LogEntry[] => mergeLogs();

export const getProblemLogs = (): LogEntry[] =>
  getLogs().filter((entry) => entry.level === "warn" || entry.level === "error");

export const getErrorLogs = (): LogEntry[] => getProblemLogs();

export const clearLogs = () => {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  writeLogs([]);
  dispatchLogsUpdated();
};

export const formatLogsForShare = (entries: LogEntry[], options: { redacted?: boolean } = {}) =>
  entries
    .map((entry) => {
      const message = options.redacted ? redactExportText(entry.message) : entry.message;
      const detailsValue = options.redacted ? redactExportValue(entry.details) : entry.details;
      const details = detailsValue ? `\n${JSON.stringify(detailsValue, null, 2)}` : "";
      return `[${formatLocalTime(entry.timestamp)}] ${entry.level.toUpperCase()} - ${message}${details}`;
    })
    .join("\n\n");

/** Test-only: drop the in-memory log cache so a stubbed/cleared localStorage is re-read fresh. */
export const resetLoggingCacheForTests = () => {
  cachedLogs = null;
  if (pendingPersistTimer !== null) {
    clearTimeout(pendingPersistTimer);
  }
  pendingPersistTimer = null;
};
