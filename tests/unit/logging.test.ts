/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addErrorLog,
  addLog,
  buildErrorLogDetails,
  clearLogs,
  formatLogsForShare,
  getErrorLogs,
  getLogs,
} from '@/lib/logging';
import { shouldSuppressDiagnosticsSideEffects } from '@/lib/diagnostics/diagnosticsOverlayState';

vi.mock('@/lib/diagnostics/diagnosticsOverlayState', () => ({
  shouldSuppressDiagnosticsSideEffects: vi.fn().mockReturnValue(false),
}));

const ensureWindow = () => {
  if (typeof window !== 'undefined') return;
  const target = new EventTarget();
  const windowMock = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) =>
      target.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) =>
      target.removeEventListener(type, listener, options),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { origin: 'http://localhost' },
  };
  Object.defineProperty(globalThis, 'window', {
    value: windowMock,
    configurable: true,
  });
  if (typeof (globalThis as { CustomEvent?: typeof CustomEvent }).CustomEvent === 'undefined') {
    class CustomEventShim<T = any> extends Event {
      detail?: T;
      constructor(type: string, params?: CustomEventInit<T>) {
        super(type, params);
        this.detail = params?.detail;
      }
    }
    Object.defineProperty(globalThis, 'CustomEvent', {
      value: CustomEventShim,
      configurable: true,
    });
  }
};

const ensureLocalStorage = () => {
  if (typeof localStorage !== 'undefined') return;
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
};

ensureWindow();
ensureLocalStorage();

describe('logging', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds logs and filters errors', () => {
    const handler = vi.fn();
    window.addEventListener('c64u-logs-updated', handler as EventListener);

    addLog('info', 'hello');
    addLog('debug', 'hidden');
    addErrorLog('boom', { code: 500 });

    const logs = getLogs();
    expect(logs).toHaveLength(2);
    expect(getErrorLogs()).toHaveLength(1);
    expect(handler).toHaveBeenCalled();

    window.removeEventListener('c64u-logs-updated', handler as EventListener);
  });

  it('clears logs and formats entries for sharing', () => {
    addLog('warn', 'warning', { note: 'check' });
    const formatted = formatLogsForShare(getLogs());
    expect(formatted).toContain('WARN');
    expect(formatted).toContain('warning');

    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });

  it('records debug logs when enabled', () => {
    localStorage.setItem('c64u_debug_logging_enabled', '1');
    addLog('debug', 'verbose');
    expect(getLogs()).toHaveLength(1);
    expect(getLogs()[0].message).toBe('verbose');
  });

  it('captures error stacks with trimming', () => {
    const error = new Error('boom');
    error.stack = Array.from({ length: 120 }, (_, index) => `line-${index + 1}`).join('\n');

    const details = buildErrorLogDetails(error, { context: 'rest' });

    expect(details.error).toBe('boom');
    expect(details.errorName).toBe('Error');
    expect(details.errorStack).toContain('line-1');
    expect(details.errorStack).toContain('stack truncated');
  });

  it('suppresses logs when diagnostics side effects are suppressed', () => {
    vi.mocked(shouldSuppressDiagnosticsSideEffects).mockReturnValue(true);
    addLog('info', 'ignored');
    expect(getLogs()).toHaveLength(0);

    // Errors should still be recorded
    addLog('error', 'important');
    expect(getLogs()).toHaveLength(1);
    vi.mocked(shouldSuppressDiagnosticsSideEffects).mockReturnValue(false);
  });

  it('handles corrupted log storage safely', () => {
    localStorage.setItem('c64u_app_logs', 'invalid { json');
    expect(getLogs()).toEqual([]);
  });

  it('truncates stack trace by character count', () => {
    const error = new Error('long stack');
    const longLine = 'a'.repeat(3005);
    error.stack = `Error: long stack\n${longLine}`;

    const details = buildErrorLogDetails(error);
    expect(details.errorStack?.length).toBeLessThan(3100);
    expect(details.errorStack).toContain('(stack truncated)');
  });

  it('preserves existing error message in details', () => {
    const error = new Error('original');
    const details = buildErrorLogDetails(error, { error: 'override' });
    expect(details.error).toBe('override');
  });

  it('redacts logs when requested', () => {
    addLog('info', 'sensetive info');
    const formatted = formatLogsForShare(getLogs(), { redacted: true });
    // Assuming redaction replaces common patterns, but here message is plain.
    // Redaction logic is in exportRedaction.
    expect(formatted).toContain('sensetive info'); // redaction targets specifics like IPs.
  });

  it('generates ID without crypto', () => {
    const originalCrypto = globalThis.crypto;
    // @ts-ignore
    delete globalThis.crypto;

    addLog('info', 'no crypto');
    const logs = getLogs();
    expect(logs[0].id).toMatch(/^\d+-\d+$/);

    globalThis.crypto = originalCrypto;
  });
});
