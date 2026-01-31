import { describe, expect, it } from 'vitest';
import { getTraceIdSnapshot, nextCorrelationId, nextTraceEventId, resetTraceIds } from '@/lib/tracing/traceIds';

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
});
