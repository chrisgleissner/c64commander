import { describe, expect, it } from 'vitest';
import { buildActionSummaries } from '@/lib/diagnostics/actionSummaries';
import type { TraceEvent } from '@/lib/tracing/types';

const buildTrace = (overrides: Partial<TraceEvent> & Pick<TraceEvent, 'id' | 'type' | 'correlationId'>): TraceEvent => ({
  id: overrides.id,
  timestamp: overrides.timestamp ?? '2024-01-01T00:00:00.000Z',
  relativeMs: overrides.relativeMs ?? 0,
  type: overrides.type,
  origin: overrides.origin ?? 'user',
  correlationId: overrides.correlationId,
  data: overrides.data ?? {},
});

describe('buildActionSummaries', () => {
  it('derives summaries with origin mapping, effects, and error counts', () => {
    const traces: TraceEvent[] = [
      buildTrace({
        id: 'EVT-0000',
        type: 'action-start',
        correlationId: 'COR-0001',
        relativeMs: 0,
        data: { name: 'playback.start' },
      }),
      buildTrace({
        id: 'EVT-0001',
        type: 'rest-request',
        correlationId: 'COR-0001',
        relativeMs: 100,
        data: {
          method: 'GET',
          url: 'http://device/v1/info',
          normalizedUrl: '/v1/info',
          headers: {},
          body: null,
          target: 'real-device',
        },
      }),
      buildTrace({
        id: 'EVT-0002',
        type: 'rest-response',
        correlationId: 'COR-0001',
        relativeMs: 150,
        data: { status: 200, body: {}, durationMs: 50, error: null },
      }),
      buildTrace({
        id: 'EVT-0003',
        type: 'ftp-operation',
        correlationId: 'COR-0001',
        relativeMs: 200,
        data: { operation: 'list', path: '/SIDS', result: 'failure', error: 'Denied', target: 'real-device' },
      }),
      buildTrace({
        id: 'EVT-0004',
        type: 'error',
        correlationId: 'COR-0001',
        relativeMs: 210,
        data: { message: 'FTP failed', name: 'Error' },
      }),
      buildTrace({
        id: 'EVT-0005',
        type: 'action-end',
        correlationId: 'COR-0001',
        relativeMs: 300,
        data: { status: 'error', error: 'FTP failed' },
      }),
      buildTrace({
        id: 'EVT-0006',
        type: 'action-start',
        correlationId: 'COR-0002',
        relativeMs: 400,
        origin: 'automatic',
        data: { name: 'background.refresh' },
      }),
      buildTrace({
        id: 'EVT-0007',
        type: 'rest-request',
        correlationId: 'COR-0002',
        relativeMs: 420,
        origin: 'automatic',
        data: {
          method: 'POST',
          url: 'http://device/v1/configs',
          normalizedUrl: '/v1/configs',
          headers: {},
          body: { foo: 'bar' },
          target: 'real-device',
        },
      }),
    ];

    const summaries = buildActionSummaries(traces);
    expect(summaries).toHaveLength(2);

    const first = summaries[0];
    expect(first.correlationId).toBe('COR-0001');
    expect(first.summaryOrigin).toBe('HUMAN');
    expect(first.restCount).toBe(1);
    expect(first.ftpCount).toBe(1);
    expect(first.errorCount).toBe(1);
    expect(first.outcome).toBe('ERROR');

    const restEffect = first.effects.find((effect) => effect.type === 'REST');
    expect(restEffect).toBeDefined();
    expect(restEffect && 'method' in restEffect ? restEffect.method : '').toBe('GET');
    expect(restEffect && 'path' in restEffect ? restEffect.path : '').toBe('/v1/info');

    const ftpEffect = first.effects.find((effect) => effect.type === 'FTP');
    expect(ftpEffect).toBeDefined();
    expect(ftpEffect && 'operation' in ftpEffect ? ftpEffect.operation : '').toBe('list');

    const second = summaries[1];
    expect(second.correlationId).toBe('COR-0002');
    expect(second.summaryOrigin).toBe('MACHINE');
    expect(second.outcome).toBe('INCOMPLETE');
    expect(second.restCount).toBe(1);
    expect(second.ftpCount).toBe(0);
    expect(second.errorCount).toBe(0);
  });
});
