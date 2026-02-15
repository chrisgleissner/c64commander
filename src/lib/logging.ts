/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadDebugLoggingEnabled } from '@/lib/config/appSettings';
import { redactExportValue, redactExportText } from '@/lib/diagnostics/exportRedaction';
import { formatLocalTime } from '@/lib/diagnostics/timeFormat';
import { shouldSuppressDiagnosticsSideEffects } from '@/lib/diagnostics/diagnosticsOverlayState';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  details?: unknown;
};

const MAX_STACK_LINES = 30;
const MAX_STACK_CHARS = 3000;

const LOG_KEY = 'c64u_app_logs';
const MAX_LOGS = 500;
let externalLogs: LogEntry[] = [];

const buildId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
  `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const readLogs = (): LogEntry[] => {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LogEntry[];
  } catch (error) {
    console.warn('Failed to parse stored logs', { error });
    return [];
  }
};

const writeLogs = (logs: LogEntry[]) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)));
};

export const addLog = (level: LogLevel, message: string, details?: unknown) => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  if (shouldSuppressDiagnosticsSideEffects() && level !== 'error') return;
  if (level === 'debug' && !loadDebugLoggingEnabled()) return;
  const entry: LogEntry = {
    id: buildId(),
    level,
    message,
    timestamp: new Date().toISOString(),
    details,
  };
  const logs = [entry, ...readLogs()];
  writeLogs(logs);
  window.dispatchEvent(new CustomEvent('c64u-logs-updated'));
};

export const addErrorLog = (message: string, details?: unknown) => {
  addLog('error', message, details);
};

const trimStack = (stack?: string | null) => {
  if (!stack) return null;
  let lines = stack.split('\n');
  if (lines.length > MAX_STACK_LINES) {
    lines = [...lines.slice(0, MAX_STACK_LINES), '... (stack truncated)'];
  }
  let result = lines.join('\n');
  if (result.length > MAX_STACK_CHARS) {
    result = `${result.slice(0, MAX_STACK_CHARS)}... (stack truncated)`;
  }
  return result;
};

export const buildErrorLogDetails = (error: Error, details: Record<string, unknown> = {}) => ({
  ...details,
  error: {
    name: error.name,
    message: typeof details.error === 'string' ? details.error : error.message,
    stack: trimStack(error.stack),
  },
  errorName: error.name,
  errorStack: trimStack(error.stack),
});

export const setExternalLogs = (logs: LogEntry[]) => {
  if (typeof window === 'undefined') return;
  externalLogs = logs;
  window.dispatchEvent(new CustomEvent('c64u-logs-updated'));
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
  getLogs().filter((entry) => entry.level === 'warn' || entry.level === 'error');

export const getErrorLogs = (): LogEntry[] => getProblemLogs();

export const clearLogs = () => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  writeLogs([]);
  window.dispatchEvent(new CustomEvent('c64u-logs-updated'));
};

export const formatLogsForShare = (
  entries: LogEntry[],
  options: { redacted?: boolean } = {},
) =>
  entries
    .map((entry) => {
      const message = options.redacted ? redactExportText(entry.message) : entry.message;
      const detailsValue = options.redacted ? redactExportValue(entry.details) : entry.details;
      const details = detailsValue ? `\n${JSON.stringify(detailsValue, null, 2)}` : '';
      return `[${formatLocalTime(entry.timestamp)}] ${entry.level.toUpperCase()} - ${message}${details}`;
    })
    .join('\n\n');
