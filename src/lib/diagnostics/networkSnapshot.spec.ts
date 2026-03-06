import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildNetworkSnapshot } from './networkSnapshot';
import { getTraceEvents } from '@/lib/tracing/traceSession';

vi.mock('@/lib/tracing/traceSession', () => ({
  getTraceEvents: vi.fn(),
}));

describe('networkSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty snapshot when there are no events', () => {
    vi.mocked(getTraceEvents).mockReturnValue([]);
    const snapshot = buildNetworkSnapshot();
    expect(snapshot.requests).toEqual([]);
    expect(snapshot.successCount).toBe(0);
    expect(snapshot.failureCount).toBe(0);
  });

  it('counts successful requests accurately', () => {
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: '1',
        correlationId: 'c1',
        type: 'rest-request',
        data: { url: 'http://192.168.1.100/api', method: 'GET' },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
      {
        id: '2',
        correlationId: 'c1',
        type: 'rest-response',
        data: { status: 200, durationMs: 15 },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
    ]);

    const snapshot = buildNetworkSnapshot();
    expect(snapshot.successCount).toBe(1);
    expect(snapshot.failureCount).toBe(0);
    expect(snapshot.requests[0]).toMatchObject({
      hostname: '192.168.1.100',
      durationMs: 15,
      httpStatus: 200,
    });
  });

  it('counts failed requests accurately', () => {
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: '3',
        correlationId: 'c2',
        type: 'rest-request',
        data: { url: 'https://localhost/api', method: 'POST' },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
      {
        id: '4',
        correlationId: 'c2',
        type: 'rest-response',
        data: {
          status: 500,
          error: {
            name: 'NetworkError',
            code: 'ETIMEDOUT',
            message: 'Connection timed out',
          },
        },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
    ]);

    const snapshot = buildNetworkSnapshot();
    expect(snapshot.successCount).toBe(0);
    expect(snapshot.failureCount).toBe(1);
    expect(snapshot.requests[0]).toMatchObject({
      hostname: 'localhost',
      resolvedIp: '127.0.0.1',
      port: 443,
      protocol: 'https',
      httpStatus: 500,
      errorDomain: 'NetworkError',
      errorCode: 'ETIMEDOUT',
      errorMessage: 'Connection timed out',
    });
  });

  it('handles requests missing url', () => {
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: '5',
        correlationId: 'c3',
        type: 'rest-request',
        data: {},
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
    ]);

    const snapshot = buildNetworkSnapshot();
    expect(snapshot.requests[0]?.hostname).toBeNull();
    expect(snapshot.requests[0]?.protocol).toBeNull();
  });

  it('ignores other event types', () => {
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: '6',
        correlationId: 'c4',
        type: 'other-event' as any,
        data: {},
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
    ]);

    const snapshot = buildNetworkSnapshot();
    expect(snapshot.requests.length).toBe(0);
  });

  it('handles invalid urls', () => {
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: '7',
        correlationId: 'c5',
        type: 'rest-request',
        data: { url: 'not-a-valid-url' },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
      {
        id: '8',
        correlationId: 'c5',
        type: 'rest-response',
        data: { status: 200, durationMs: 15 },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
    ]);

    const snapshot = buildNetworkSnapshot();
    expect(snapshot.requests[0]?.hostname).toBeNull();
  });

  it('handles error objects without standard properties', () => {
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: '9',
        correlationId: 'c6',
        type: 'rest-request',
        data: { url: 'http://192.168.1.100/api' },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
      {
        id: '10',
        correlationId: 'c6',
        type: 'rest-response',
        data: { status: 500, error: { something_else: 'value' } },
        timestamp: '2023-01-01T00:00:00Z',
        level: 'info',
      },
    ]);

    const snapshot = buildNetworkSnapshot();
    expect(snapshot.requests[0]?.errorDomain).toBeNull();
    expect(snapshot.requests[0]?.errorCode).toBeNull();
    expect(snapshot.requests[0]?.errorMessage).toBeNull();
  });
});
