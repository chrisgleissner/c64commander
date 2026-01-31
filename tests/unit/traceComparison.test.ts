import { describe, expect, it } from 'vitest';
import { compareTracesEssential } from '../../playwright/traceComparison.js';

type TraceEvent = {
  id: string;
  timestamp: string;
  relativeMs: number;
  type: string;
  origin: string;
  correlationId: string;
  data: Record<string, unknown>;
};

const makeEvent = (overrides: Partial<TraceEvent> & { type: string }): TraceEvent => ({
  id: overrides.id ?? 'EVT-0000',
  timestamp: overrides.timestamp ?? new Date(0).toISOString(),
  relativeMs: overrides.relativeMs ?? 0,
  type: overrides.type,
  origin: overrides.origin ?? 'ui',
  correlationId: overrides.correlationId ?? 'COR-0000',
  data: overrides.data ?? {},
});

const buildRestTrace = (options: {
  ids: string[];
  correlationId: string;
  actionName: string;
  method: string;
  url: string;
  status: number;
  requestBody?: unknown;
  responseBody?: unknown;
  target?: string;
}) => {
  const [startId, requestId, responseId, endId] = options.ids;
  return [
    makeEvent({
      id: startId,
      type: 'action-start',
      correlationId: options.correlationId,
      data: { name: options.actionName },
    }),
    makeEvent({
      id: requestId,
      type: 'rest-request',
      correlationId: options.correlationId,
      data: {
        method: options.method,
        url: options.url,
        target: options.target,
        body: options.requestBody ?? null,
      },
    }),
    makeEvent({
      id: responseId,
      type: 'rest-response',
      correlationId: options.correlationId,
      data: {
        status: options.status,
        body: options.responseBody ?? null,
      },
    }),
    makeEvent({
      id: endId,
      type: 'action-end',
      correlationId: options.correlationId,
      data: { status: 'success' },
    }),
  ];
};

describe('compareTracesEssential', () => {
  it('normalizes loopback ports in REST URLs', () => {
    const expected = buildRestTrace({
      ids: ['EVT-0000', 'EVT-0001', 'EVT-0002', 'EVT-0003'],
      correlationId: 'COR-0000',
      actionName: 'rest.get',
      method: 'GET',
      url: 'http://127.0.0.1:1111/v1/info',
      status: 200,
      responseBody: { version: '1.0' },
    });
    const actual = buildRestTrace({
      ids: ['EVT-0004', 'EVT-0005', 'EVT-0006', 'EVT-0007'],
      correlationId: 'COR-0000',
      actionName: 'rest.get',
      method: 'GET',
      url: 'http://127.0.0.1:2222/v1/info',
      status: 200,
      responseBody: { version: '1.0' },
    });

    const errors = compareTracesEssential(expected, actual);
    expect(errors).toEqual([]);
  });

  it('ignores volatile timestamps in response bodies', () => {
    const expected = buildRestTrace({
      ids: ['EVT-0010', 'EVT-0011', 'EVT-0012', 'EVT-0013'],
      correlationId: 'COR-0010',
      actionName: 'rest.get',
      method: 'GET',
      url: 'http://127.0.0.1:3333/v1/info',
      status: 200,
      responseBody: { timestamp: '2026-01-31T00:00:00.000Z', version: '1.0' },
    });
    const actual = buildRestTrace({
      ids: ['EVT-0014', 'EVT-0015', 'EVT-0016', 'EVT-0017'],
      correlationId: 'COR-0010',
      actionName: 'rest.get',
      method: 'GET',
      url: 'http://127.0.0.1:4444/v1/info',
      status: 200,
      responseBody: { timestamp: '2026-01-31T00:00:05.000Z', version: '1.0' },
    });

    const errors = compareTracesEssential(expected, actual);
    expect(errors).toEqual([]);
  });

  it('normalizes port fields in REST payloads', () => {
    const expected = buildRestTrace({
      ids: ['EVT-0030', 'EVT-0031', 'EVT-0032', 'EVT-0033'],
      correlationId: 'COR-0030',
      actionName: 'rest.post',
      method: 'POST',
      url: 'http://127.0.0.1:5555/v1/ftp/list',
      status: 200,
      requestBody: { host: '127.0.0.1', port: 1234, path: '/' },
      responseBody: { entries: [] },
    });
    const actual = buildRestTrace({
      ids: ['EVT-0034', 'EVT-0035', 'EVT-0036', 'EVT-0037'],
      correlationId: 'COR-0030',
      actionName: 'rest.post',
      method: 'POST',
      url: 'http://127.0.0.1:6666/v1/ftp/list',
      status: 200,
      requestBody: { host: '127.0.0.1', port: 9999, path: '/' },
      responseBody: { entries: [] },
    });

    const errors = compareTracesEssential(expected, actual);
    expect(errors).toEqual([]);
  });

  it('fails on semantic REST differences', () => {
    const expected = buildRestTrace({
      ids: ['EVT-0020', 'EVT-0021', 'EVT-0022', 'EVT-0023'],
      correlationId: 'COR-0020',
      actionName: 'rest.get',
      method: 'GET',
      url: 'http://127.0.0.1:5555/v1/info',
      status: 200,
    });
    const actual = buildRestTrace({
      ids: ['EVT-0024', 'EVT-0025', 'EVT-0026', 'EVT-0027'],
      correlationId: 'COR-0020',
      actionName: 'rest.get',
      method: 'POST',
      url: 'http://127.0.0.1:6666/v1/info',
      status: 200,
    });

    const errors = compareTracesEssential(expected, actual);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('collapses duplicate GET /v1/info actions', () => {
    const expected = [
      ...buildRestTrace({
        ids: ['EVT-0100', 'EVT-0101', 'EVT-0102', 'EVT-0103'],
        correlationId: 'COR-0100',
        actionName: 'rest.get',
        method: 'GET',
        url: 'http://127.0.0.1:7777/v1/info',
        status: 200,
        target: 'real-device',
      }),
      ...buildRestTrace({
        ids: ['EVT-0104', 'EVT-0105', 'EVT-0106', 'EVT-0107'],
        correlationId: 'COR-0101',
        actionName: 'rest.get',
        method: 'GET',
        url: 'http://127.0.0.1:8888/v1/info',
        status: 200,
        target: 'external-mock',
      }),
    ];
    const actual = buildRestTrace({
      ids: ['EVT-0110', 'EVT-0111', 'EVT-0112', 'EVT-0113'],
      correlationId: 'COR-0100',
      actionName: 'rest.get',
      method: 'GET',
      url: 'http://127.0.0.1:9999/v1/info',
      status: 200,
    });

    const errors = compareTracesEssential(expected, actual);
    expect(errors).toEqual([]);
  });
});
