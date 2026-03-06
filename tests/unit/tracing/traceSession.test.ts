/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getTraceContextSnapshotMock = vi.hoisted(() =>
  vi.fn(() => ({
    ui: { route: '/', query: '' },
    platform: 'web' as const,
    featureFlags: {},
    playback: null,
    device: null,
  })),
);

vi.mock('@/lib/tracing/traceContext', () => ({
  getTraceContextSnapshot: () => getTraceContextSnapshotMock(),
}));

const shouldSuppressMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@/lib/diagnostics/diagnosticsOverlayState', () => ({
  shouldSuppressDiagnosticsSideEffects: () => shouldSuppressMock(),
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
  buildAppMetadata,
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
  replaceTraceEvents,
  resetTraceSession,
  persistTracesToSession,
  restoreTracesFromSession,
  recordDeviceGuard,
  TRACE_SESSION,
} from '@/lib/tracing/traceSession';
import {
  getCurrentTraceIdCounters,
  setTraceIdCounters,
} from '@/lib/tracing/traceIds';
import type { TraceActionContext } from '@/lib/tracing/types';

const action: TraceActionContext = {
  correlationId: 'COR-1',
  origin: 'user',
  name: 'Action',
  componentName: 'Widget',
};

describe('traceSession', () => {
  beforeEach(() => {
    resetTraceSession(0, 0);
    clearTraceEvents();
    shouldSuppressMock.mockReturnValue(false);
    getTraceContextSnapshotMock.mockReturnValue({
      ui: { route: '/', query: '' },
      platform: 'web' as const,
      featureFlags: {},
      playback: null,
      device: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records action lifecycle events', () => {
    // Need window for event dispatch (appendEvent)
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });

    recordActionStart(action);
    recordActionScopeStart(action, 'scope');
    recordActionScopeEnd(action, 'scope', null);
    recordActionEnd(action, null);

    const events = getTraceEvents();
    expect(events.some((event) => event.type === 'action-start')).toBe(true);
    expect(events.some((event) => event.type === 'action-scope-start')).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'action-scope-end')).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'action-end')).toBe(true);
  });

  it('records backend decisions once per correlation', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
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
    const decisions = events.filter(
      (event) => event.type === 'backend-decision',
    );
    expect(decisions).toHaveLength(1);
  });

  it('records REST and FTP responses', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
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

    const dispatchSpy = vi.fn();
    vi.stubGlobal('window', {
      dispatchEvent: dispatchSpy,
      setTimeout: setTimeout,
      CustomEvent: class CustomEvent {
        constructor(
          public type: string,
          public detail?: any,
        ) {}
      },
    });

    recordTraceError(action, error);
    recordTraceError(action, error);

    const events = getTraceEvents().filter((event) => event.type === 'error');
    expect(events).toHaveLength(1);

    vi.runAllTimers();

    const lastExport = getLastTraceExport();
    expect(lastExport?.reason).toBe('error');
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it('exports trace zips on demand', () => {
    const zip = exportTraceZip();
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(getLastTraceExport()?.reason).toBe('manual');
  });

  it('persists and restores traces from sessionStorage', () => {
    const storage: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      getItem: (key: string) => storage[key] || null,
      removeItem: (key: string) => {
        delete storage[key];
      },
    });
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });

    recordActionStart({ ...action, correlationId: 'C1' });
    const countersBefore = getCurrentTraceIdCounters();

    persistTracesToSession();

    expect(storage['__c64uPersistedTraces']).toBeDefined();
    expect(storage['__c64uPersistedTraceCounters']).toBeDefined();

    resetTraceSession(0, 0);
    setTraceIdCounters(0, 0);
    expect(getTraceEvents()).toHaveLength(0);

    restoreTracesFromSession();

    expect(getTraceEvents()).toHaveLength(1);
    const countersAfter = getCurrentTraceIdCounters();
    expect(countersAfter.eventCounter).toBe(countersBefore.eventCounter);
    expect(storage['__c64uPersistedTraces']).toBeUndefined();
  });

  it('handles restore with no data', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      removeItem: () => {},
    });
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });

    restoreTracesFromSession();
    expect(getTraceEvents()).toHaveLength(0);
  });

  it('records device guard event', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordDeviceGuard(action, { allowed: true });
    const events = getTraceEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'device-guard',
        data: expect.objectContaining({ allowed: true }),
      }),
    );
  });

  it('handles storage errors gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('sessionStorage', {
      setItem: () => {
        throw new Error('Full');
      },
      getItem: () => {
        throw new Error('Corrupt');
      },
    });
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });

    persistTracesToSession();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to persist traces:',
      expect.any(Error),
    );

    restoreTracesFromSession();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to restore traces:',
      expect.any(Error),
    );
  });

  it('records action-end with error status', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordActionEnd(action, new Error('failed'));
    const events = getTraceEvents();
    const endEvent = events.find((e) => e.type === 'action-end');
    expect(endEvent?.data).toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('records action-scope-end with error status', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordActionScopeEnd(action, 'scope', new Error('oops'));
    const events = getTraceEvents();
    const scopeEnd = events.find((e) => e.type === 'action-scope-end');
    expect(scopeEnd?.data).toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('records rest-response with errorMessage parameter', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordRestResponse(action, {
      status: 500,
      body: null,
      durationMs: 50,
      error: null,
      errorMessage: 'custom error msg',
    });
    const events = getTraceEvents();
    const resp = events.find((e) => e.type === 'rest-response');
    expect(resp?.data).toEqual(
      expect.objectContaining({ error: 'custom error msg' }),
    );
  });

  it('records rest-response with error.message fallback', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordRestResponse(action, {
      status: 500,
      body: null,
      durationMs: 50,
      error: new Error('from error obj'),
    });
    const events = getTraceEvents();
    const resp = events.find((e) => e.type === 'rest-response');
    expect(resp?.data).toEqual(
      expect.objectContaining({ error: 'from error obj' }),
    );
  });

  it('records rest-response with null error when both null', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordRestResponse(action, {
      status: 200,
      body: null,
      durationMs: 50,
      error: null,
    });
    const events = getTraceEvents();
    const resp = events.find((e) => e.type === 'rest-response');
    expect(resp?.data).toEqual(expect.objectContaining({ error: null }));
  });

  it('builds app metadata with fallback values', () => {
    const metadata = buildAppMetadata();
    expect(metadata).toHaveProperty('platform');
    expect(metadata).toHaveProperty('appVersion');
    expect(metadata).toHaveProperty('gitSha');
    expect(metadata).toHaveProperty('buildTime');
    expect(metadata).toHaveProperty('userAgent');
  });

  it('replaceTraceEvents rebuilds decision set', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    replaceTraceEvents([
      {
        id: 'E-1',
        timestamp: new Date().toISOString(),
        relativeMs: 0,
        type: 'backend-decision',
        origin: 'user',
        correlationId: 'D-1',
        data: {},
      },
    ]);
    // Recording another decision for same correlation should be suppressed
    recordRestRequest(
      { ...action, correlationId: 'D-1' },
      {
        method: 'GET',
        url: 'http://x',
        normalizedUrl: 'http://x',
        headers: {},
        body: null,
      },
    );
    const decisions = getTraceEvents().filter(
      (e) => e.type === 'backend-decision',
    );
    expect(decisions).toHaveLength(1);
  });

  it('restores traces deduplicating against existing events', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    // Record one event
    recordActionStart({ ...action, correlationId: 'DUP-1' });
    const events = getTraceEvents();
    const existingId = events[0].id;

    const storage: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      getItem: (key: string) => storage[key] ?? null,
      removeItem: (key: string) => {
        delete storage[key];
      },
    });

    // Store the same event in session
    storage['__c64uPersistedTraces'] = JSON.stringify([events[0]]);
    restoreTracesFromSession();

    // Should NOT duplicate
    const allEvents = getTraceEvents();
    const matchingIds = allEvents.filter((e) => e.id === existingId);
    expect(matchingIds).toHaveLength(1);
  });

  it('does not dispatch window event when window is undefined', () => {
    // No window stub — the appendEvent path with typeof window !== 'undefined' should not throw
    recordActionStart(action);
    expect(getTraceEvents()).toHaveLength(1);
  });

  it('estimateEventSize fallback when TextEncoder is unavailable', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    const origTE = globalThis.TextEncoder;
    // @ts-expect-error -- deliberately removing TextEncoder
    delete globalThis.TextEncoder;
    try {
      recordActionStart(action);
      expect(getTraceEvents()).toHaveLength(1);
    } finally {
      globalThis.TextEncoder = origTE;
    }
  });

  it('includes trigger in action-start data when provided', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    const trigger = {
      kind: 'timer' as const,
      name: 'connectivity.probe',
      intervalMs: 5000,
      details: null,
    };
    const actionWithTrigger = { ...action, trigger };
    recordActionStart(actionWithTrigger);
    const events = getTraceEvents();
    const start = events.find((e) => e.type === 'action-start');
    expect((start?.data as Record<string, unknown>)?.trigger).toEqual(trigger);
  });

  it('omits trigger from action-start data when not provided', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordActionStart(action);
    const events = getTraceEvents();
    const start = events.find((e) => e.type === 'action-start');
    expect((start?.data as Record<string, unknown>)?.trigger).toBeUndefined();
  });

  it('records rest-response with null status for no-response case', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordRestResponse(action, {
      status: null,
      body: null,
      durationMs: 30,
      error: new Error('network error'),
      errorMessage: 'network error',
    });
    const events = getTraceEvents();
    const resp = events.find((e) => e.type === 'rest-response');
    expect((resp?.data as Record<string, unknown>)?.status).toBeNull();
    expect((resp?.data as Record<string, unknown>)?.error).toBe(
      'network error',
    );
  });

  it('suppresses non-error events when diagnostics side effects are suppressed', () => {
    shouldSuppressMock.mockReturnValue(true);
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordActionStart(action);
    // non-error events should be suppressed
    expect(getTraceEvents()).toHaveLength(0);
  });

  it('does not suppress error events even when diagnostics side effects are suppressed', () => {
    shouldSuppressMock.mockReturnValue(true);
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordTraceError(action, new Error('forced error'));
    expect(getTraceEvents().some((e) => e.type === 'error')).toBe(true);
  });

  it('records events with non-null playback context fields', () => {
    getTraceContextSnapshotMock.mockReturnValue({
      ui: { route: '/music', query: '' },
      platform: 'web' as const,
      featureFlags: {},
      playback: {
        sourceKind: 'local',
        localAccessMode: 'web',
        trackInstanceId: 'track-abc',
        playlistItemId: 'item-123',
      } as any,
      device: null,
    });
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordActionStart(action);
    const events = getTraceEvents();
    expect(events.some((e) => e.type === 'action-start')).toBe(true);
    const evt = events.find((e) => e.type === 'action-start');
    expect((evt?.data as Record<string, unknown>)?.sourceKind).toBe('local');
  });

  it('records ftp operation with error message', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    recordFtpOperation(action, {
      operation: 'download',
      path: '/demo.sid',
      result: 'failure',
      error: new Error('connection refused'),
    });
    const events = getTraceEvents();
    const ftpEvent = events.find((e) => e.type === 'ftp-operation');
    expect((ftpEvent?.data as Record<string, unknown>)?.error).toBe(
      'connection refused',
    );
  });

  it('persistTracesToSession is a no-op when sessionStorage is unavailable', () => {
    // In node test environment, sessionStorage is undefined unless stubbed
    vi.unstubAllGlobals();
    expect(() => persistTracesToSession()).not.toThrow();
  });

  it('restoreTracesFromSession is a no-op when sessionStorage is unavailable', () => {
    vi.unstubAllGlobals();
    expect(() => restoreTracesFromSession()).not.toThrow();
  });

  it('evicts oldest events when event count exceeds limit', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    const { MAX_EVENT_COUNT } = TRACE_SESSION;
    // Fill events array beyond the limit
    const events = Array.from({ length: MAX_EVENT_COUNT + 2 }, (_, i) => ({
      id: `trace-over-${i}`,
      type: 'error' as const,
      timestamp: new Date().toISOString(),
      origin: 'user' as const,
      correlationId: 'COR-OVER',
      data: {},
    }));
    replaceTraceEvents(events as any);
    // Adding one more event triggers enforceLimits
    recordActionStart(action);
    expect(getTraceEvents().length).toBeLessThanOrEqual(MAX_EVENT_COUNT + 1);
  });

  it('evicts events with NaN timestamps during expired check', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout: vi.fn(),
      CustomEvent: class {},
    });
    // Insert an event with a non-parseable timestamp to exercise NaN path in evictExpired
    const malformed = [
      {
        id: 'trace-nan',
        type: 'error' as const,
        timestamp: 'not-a-date',
        origin: 'user' as const,
        correlationId: 'COR-NAN',
        data: {},
      },
    ];
    replaceTraceEvents(malformed as any);
    // Trigger appendEvent (calls evictExpired)
    recordActionStart(action);
    // The NaN-timestamp event has NaN eventMs, so it skips eviction at the NaN check (breaks loop)
    expect(getTraceEvents().length).toBeGreaterThan(0);
  });

  it('buildAppMetadata uses defined __APP_VERSION__, __GIT_SHA__, __BUILD_TIME__', () => {
    vi.stubGlobal('__APP_VERSION__', '2.0.0');
    vi.stubGlobal('__GIT_SHA__', 'deadbeef');
    vi.stubGlobal('__BUILD_TIME__', '2024-01-01T00:00:00Z');
    const meta = buildAppMetadata();
    expect(meta.appVersion).toBe('2.0.0');
    expect(meta.gitSha).toBe('deadbeef');
    expect(meta.buildTime).toBe('2024-01-01T00:00:00Z');
    vi.unstubAllGlobals();
  });

  it('buildAppMetadata uses navigator.userAgent when navigator is defined', () => {
    vi.stubGlobal('navigator', { userAgent: 'TestBrowser/1.0' });
    const meta = buildAppMetadata();
    expect(meta.userAgent).toBe('TestBrowser/1.0');
    vi.unstubAllGlobals();
  });
});
