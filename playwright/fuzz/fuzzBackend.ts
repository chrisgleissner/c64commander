export type AppLogEntry = {
  id: string;
  level: string;
  message: string;
  details?: unknown;
};

export type BackendFailureContext = {
  now: number;
  serverReachable: boolean;
  networkOffline: boolean;
  faultMode: 'none' | 'slow' | 'timeout' | 'refused';
  lastOutageAt: number;
};

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

const extractErrorText = (entry: AppLogEntry) => {
  const details = entry.details as Record<string, unknown> | undefined;
  const rawError = toText(details?.rawError);
  const error = toText(details?.error);
  return `${entry.message} ${rawError} ${error}`.trim();
};

export const isBackendFailureLog = (entry: AppLogEntry) => {
  const text = extractErrorText(entry).toLowerCase();
  if (!text) return false;
  if (text.includes('c64 api request failed')) return true;
  if (text.includes('failed to load resource')) return true;
  if (text.includes('service unavailable')) return true;
  if (text.includes('http 503')) return true;
  return false;
};

export const shouldIgnoreBackendFailure = (entry: AppLogEntry, context: BackendFailureContext) => {
  if (!isBackendFailureLog(entry)) return false;
  const text = extractErrorText(entry).toLowerCase();
  if (text.includes('http 503') || text.includes('service unavailable')) return true;
  if (text.includes('failed to fetch') || text.includes('net::err') || text.includes('host unreachable')) return true;
  if (!context.serverReachable) return true;
  if (context.networkOffline) return true;
  if (context.faultMode !== 'none') return true;
  if (context.lastOutageAt > 0 && context.now - context.lastOutageAt < 60000) return true;
  return false;
};

type BackendFailureTracker = {
  recordFailure: () => number;
  reset: () => void;
  getBackoffUntilMs: () => number;
  getStreak: () => number;
};

export const createBackendFailureTracker = (options: {
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
}): BackendFailureTracker => {
  let streak = 0;
  let backoffUntilMs = 0;

  const computeBackoff = (nextStreak: number) => {
    if (options.baseDelayMs <= 0 || options.maxDelayMs <= 0) return 0;
    const factor = Math.max(1, options.factor);
    const delay = Math.round(options.baseDelayMs * Math.pow(factor, Math.max(0, nextStreak - 1)));
    return Math.min(options.maxDelayMs, delay);
  };

  return {
    recordFailure: () => {
      streak += 1;
      const delayMs = computeBackoff(streak);
      const now = Date.now();
      if (delayMs > 0) {
        backoffUntilMs = Math.max(backoffUntilMs, now + delayMs);
      }
      return delayMs;
    },
    reset: () => {
      streak = 0;
      backoffUntilMs = 0;
    },
    getBackoffUntilMs: () => backoffUntilMs,
    getStreak: () => streak,
  };
};
