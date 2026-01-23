import { loadDebugLoggingEnabled } from '@/lib/config/appSettings';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  details?: unknown;
};

const LOG_KEY = 'c64u_app_logs';
const MAX_LOGS = 500;

const buildId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
  `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const readLogs = (): LogEntry[] => {
  const raw = localStorage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LogEntry[];
  } catch {
    return [];
  }
};

const writeLogs = (logs: LogEntry[]) => {
  localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)));
};

export const addLog = (level: LogLevel, message: string, details?: unknown) => {
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

export const getLogs = (): LogEntry[] => readLogs();

export const getErrorLogs = (): LogEntry[] => readLogs().filter((entry) => entry.level === 'error');

export const clearLogs = () => {
  writeLogs([]);
  window.dispatchEvent(new CustomEvent('c64u-logs-updated'));
};

export const formatLogsForShare = (entries: LogEntry[]) =>
  entries
    .map((entry) => {
      const details = entry.details ? `\n${JSON.stringify(entry.details, null, 2)}` : '';
      return `[${entry.timestamp}] ${entry.level.toUpperCase()} - ${entry.message}${details}`;
    })
    .join('\n\n');
