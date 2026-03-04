/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
  faultMode: 'none' | 'slow' | 'timeout' | 'refused' | 'auth';
  lastOutageAt: number;
};

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

const extractText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return [toText(obj.message), toText(obj.name)].filter(Boolean).join(' ');
  }
  return '';
};

const extractErrorText = (entry: AppLogEntry) => {
  const details = entry.details as Record<string, unknown> | undefined;
  const rawError = extractText(details?.rawError);
  const error = extractText(details?.error);
  const description = toText(details?.description);
  return `${entry.message} ${rawError} ${error} ${description}`.trim();
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

/**
 * Returns true for app log entries that represent device-operation failures
 * which are expected when the server is unavailable or in a fault mode.
 * These include HOME page control actions, drive operations, upload failures,
 * and HVSC filesystem operations that have graceful fallback paths.
 */
export const isDeviceOperationFailure = (entry: AppLogEntry): boolean => {
  const msg = entry.message;
  if (/^HOME_[A-Z_]+: /.test(msg)) return true;
  if (/^AUDIO_ROUTING: /.test(msg)) return true;
  if (/^(RESET_DRIVES|DRIVE_POWER|DRIVE_CONFIG_UPDATE|SOFT_IEC_CONFIG_UPDATE): /.test(msg)) return true;
  if (/^(RAM_DUMP_FOLDER_SELECT|BROWSE|CONFIG_UPDATE): /.test(msg)) return true;
  if (msg.includes('FTP listing failed')) return true;
  if (msg.includes('Source browse failed')) return true;
  if (msg.includes('C64 API request failed') || msg.includes('C64 API upload failed')) return true;
  if (msg.includes('RAM operation retry')) return true;
  if (msg.includes('Failed to resume machine after clear-memory error')) return true;
  if (msg.includes('HVSC paged folder listing failed')) return true;
  if (msg.includes('HVSC songlengths directory bootstrap failed')) return true;
  if (msg.includes('HVSC progress interrupted')) return true;
  return false;
};

export const isAlwaysExpectedFuzzBehavior = (entry: AppLogEntry): boolean => {
  return entry.message.toLowerCase().includes('fuzz mode blocked');
};

export const shouldIgnoreBackendFailure = (entry: AppLogEntry, _context: BackendFailureContext) => {
  return isAlwaysExpectedFuzzBehavior(entry);
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
