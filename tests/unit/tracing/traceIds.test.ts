/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { getTraceIdSnapshot, nextCorrelationId, nextTraceEventId, resetTraceIds, getCurrentTraceIdCounters, setTraceIdCounters } from '@/lib/tracing/traceIds';

describe('traceIds', () => {
  it('increments event and correlation IDs', () => {
    resetTraceIds(0, 0);
    expect(nextTraceEventId()).toBe('EVT-0000');
    expect(nextTraceEventId()).toBe('EVT-0001');
    expect(nextCorrelationId()).toBe('COR-0000');
    expect(nextCorrelationId()).toBe('COR-0001');
  });

  it('resets counters and exposes snapshot', () => {
    resetTraceIds(5, 12);
    expect(getTraceIdSnapshot()).toEqual({ nextEventId: 'EVT-0005', nextCorrelationId: 'COR-0012' });
  });

  it('gets current counters', () => {
     resetTraceIds(10, 20);
     const counters = getCurrentTraceIdCounters();
     // eventCounter = 9 after reset(10), correlationCounter = 19
     expect(counters.eventCounter).toBe(9); 
     expect(counters.correlationCounter).toBe(19);
  });

  it('sets counters manually', () => {
    setTraceIdCounters(100, 200);
    const counters = getCurrentTraceIdCounters();
    expect(counters.eventCounter).toBe(100);
    expect(counters.correlationCounter).toBe(200);
    
    expect(nextTraceEventId()).toBe('EVT-0101');
    expect(nextCorrelationId()).toBe('COR-0201');
  });
});
