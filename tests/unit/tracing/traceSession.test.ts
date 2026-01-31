import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tracing/traceContext', () => ({
  getTraceContextSnapshot: () => ({ ui: { route: '/', query: '' }, platform: 'web', featureFlags: {}, playback: null, device: null }),
}));

vi.mock('@/lib/tracing/traceTargets', () => ({
  resolveBackendTarget: () => ({ target: 'real-device', reason: 'reachable' }),
}));

vi.mock('@/lib/tracing/redaction', () => ({
  redactHeaders: (value: unknown) => value,
  redactPayload: (value: unknown) => value,
  redactErrorMessage: (value: string) => value,
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'web',
  isNativePlatform: () => false,
}));

import {
  clearTraceEvents,
  exportTraceZip,
  getLastTraceExport,
  getTraceEvents,
  recordActionEnd,
  recordActionScopeEnd,
  recordActionScopeStart,
  recordActionStart,
  recordFtpOperation,
  recordRestRequest,
  recordRestResponse,
  recordTraceError,
  resetTraceSession,
} from '@/lib/tracing/traceSession';

const action = { correlationId: 'COR-1', origin: 'user', name: 'Action', componentName: 'Widget' };

describe('traceSession', () => {
  beforeEach(() => {
    resetTraceSession(0, 0);
    clearTraceEvents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records action lifecycle events', () => {
    recordActionStart(action);
    recordActionScopeStart(action, 'scope');
    recordActionScopeEnd(action, 'scope', null);
    recordActionEnd(action, null);

    const events = getTraceEvents();
    expect(events.some((event) => event.type === 'action-start')).toBe(true);
    expect(events.some((event) => event.type === 'action-scope-start')).toBe(true);
    expect(events.some((event) => event.type === 'action-scope-end')).toBe(true);
    expect(events.some((event) => event.type === 'action-end')).toBe(true);
  });

  it('records backend decisions once per correlation', () => {
    recordRestRequest(action, {
      method: 'GET',
      url: 'http://device',
      normalizedUrl: 'http://device',
      headers: {},
      body: null,
    });
    recordRestRequest(action, {
      method: 'GET',
      url: 'http://device',
      normalizedUrl: 'http://device',
      headers: {},
      body: null,
    });

    const events = getTraceEvents();
    const decisions = events.filter((event) => event.type === 'backend-decision');
    expect(decisions).toHaveLength(1);
  });

  it('records REST and FTP responses', () => {
    recordRestResponse(action, {
      status: 200,
      body: { ok: true },
      durationMs: 123,
      error: null,
    });
    recordFtpOperation(action, {
      operation: 'list',
      path: '/dir',
      result: 'success',
      error: null,
    });

    const events = getTraceEvents();
    expect(events.some((event) => event.type === 'rest-response')).toBe(true);
    expect(events.some((event) => event.type === 'ftp-operation')).toBe(true);
  });

  it('deduplicates trace errors and exports on error', async () => {
    vi.useFakeTimers();
    const error = new Error('boom');

    recordTraceError(action, error);
    recordTraceError(action, error);

    const events = getTraceEvents().filter((event) => event.type === 'error');
    expect(events).toHaveLength(1);

    vi.runAllTimers();

    const lastExport = getLastTraceExport();
    expect(lastExport?.reason).toBe('error');
  });

  it('exports trace zips on demand', () => {
    const zip = exportTraceZip();
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(getLastTraceExport()?.reason).toBe('manual');
  });
});
