/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
  persistTracesToSession,
  restoreTracesFromSession,
  recordDeviceGuard
} from '@/lib/tracing/traceSession';
import { getCurrentTraceIdCounters, setTraceIdCounters } from '@/lib/tracing/traceIds';
import type { TraceActionContext } from '@/lib/tracing/types';

const action: TraceActionContext = { correlationId: 'COR-1', origin: 'user', name: 'Action', componentName: 'Widget' };

describe('traceSession', () => {
  beforeEach(() => {
    resetTraceSession(0, 0);
    clearTraceEvents();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records action lifecycle events', () => {
    // Need window for event dispatch (appendEvent)
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout: vi.fn(), CustomEvent: class{} });
    
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
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout: vi.fn(), CustomEvent: class{} });
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
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout: vi.fn(), CustomEvent: class{} });
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
        CustomEvent: class CustomEvent { constructor(public type: string, public detail?: any) {} }
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
      setItem: (key: string, value: string) => { storage[key] = value; },
      getItem: (key: string) => storage[key] || null,
      removeItem: (key: string) => { delete storage[key]; }
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout: vi.fn(), CustomEvent: class{} });

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
      removeItem: () => {}
    });
     vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout: vi.fn(), CustomEvent: class{} });
    
    restoreTracesFromSession();
    expect(getTraceEvents()).toHaveLength(0);
  });
  
  it('records device guard event', () => {
     vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout: vi.fn(), CustomEvent: class{} });
    recordDeviceGuard(action, { allowed: true });
    const events = getTraceEvents();
    expect(events).toContainEqual(expect.objectContaining({ type: 'device-guard', data: { allowed: true } }));
  });

  it('handles storage errors gracefully', () => {
     const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
     vi.stubGlobal('sessionStorage', {
       setItem: () => { throw new Error('Full'); },
       getItem: () => { throw new Error('Corrupt'); }
     });
     vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout: vi.fn(), CustomEvent: class{} });
     
     persistTracesToSession();
     expect(consoleSpy).toHaveBeenCalledWith('Failed to persist traces:', expect.any(Error));
     
     restoreTracesFromSession();
     expect(consoleSpy).toHaveBeenCalledWith('Failed to restore traces:', expect.any(Error));
  });
});
