import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordRestRequestMock = vi.fn();
const recordRestResponseMock = vi.fn();
const recordTraceErrorMock = vi.fn();

vi.mock('@/lib/tracing/actionTrace', () => ({
  getActiveAction: () => null,
  runWithImplicitAction: async (_name: string, callback: (action: { correlationId: string; origin: 'system'; name: string }) => Promise<Response>) => {
    return callback({
      correlationId: 'COR-TEST',
      origin: 'system',
      name: 'test-action',
    });
  },
}));

vi.mock('@/lib/diagnostics/diagnosticsActivity', () => ({
  incrementRestInFlight: vi.fn(),
  decrementRestInFlight: vi.fn(),
}));

vi.mock('@/lib/tracing/traceSession', () => ({
  recordRestRequest: (...args: unknown[]) => recordRestRequestMock(...args),
  recordRestResponse: (...args: unknown[]) => recordRestResponseMock(...args),
  recordTraceError: (...args: unknown[]) => recordTraceErrorMock(...args),
}));

import { registerFetchTrace } from '../../../src/lib/tracing/fetchTrace';

describe('fetchTrace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as Window & { __c64uFetchTraceInstalled?: boolean }).__c64uFetchTraceInstalled = false;
    window.fetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof window.fetch;
  });

  it('does not warn for relative non-traced URLs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerFetchTrace();

    await window.fetch('/api/diagnostics/server-logs');

    expect(recordRestRequestMock).not.toHaveBeenCalled();
    const parseWarnings = warnSpy.mock.calls.filter(([message]) =>
      String(message).includes('Failed to parse fetch trace URL for filtering'),
    );
    expect(parseWarnings).toHaveLength(0);
  });

  it('traces relative v1 URLs with normalized path', async () => {
    registerFetchTrace();

    await window.fetch('/api/rest/v1/info');

    expect(recordRestRequestMock).toHaveBeenCalledTimes(1);
    const payload = recordRestRequestMock.mock.calls[0][1] as { normalizedUrl: string };
    expect(payload.normalizedUrl).toBe('/api/rest/v1/info');
  });
});
