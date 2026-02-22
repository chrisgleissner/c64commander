import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordRestRequestMock = vi.fn();
const recordRestResponseMock = vi.fn();
const recordTraceErrorMock = vi.fn();
const getActiveActionMock = vi.fn();
const runWithImplicitActionMock = vi.fn();

vi.mock('@/lib/tracing/actionTrace', () => ({
    getActiveAction: () => getActiveActionMock(),
    runWithImplicitAction: (...args: unknown[]) => runWithImplicitActionMock(...args),
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
        getActiveActionMock.mockReturnValue(null);
        runWithImplicitActionMock.mockImplementation(async (_name: string, callback: (action: { correlationId: string; origin: 'system'; name: string }) => Promise<Response>) => {
            return callback({
                correlationId: 'COR-TEST',
                origin: 'system',
                name: 'test-action',
            });
        });
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

    it('uses active action context when available', async () => {
        getActiveActionMock.mockReturnValue({
            correlationId: 'COR-ACTIVE',
            origin: 'user',
            name: 'active-action',
        });
        registerFetchTrace();

        await window.fetch('/api/rest/v1/info');

        expect(runWithImplicitActionMock).not.toHaveBeenCalled();
        expect(recordRestRequestMock).toHaveBeenCalledTimes(1);
    });

    it('records non-ok responses as trace errors', async () => {
        window.fetch = vi.fn().mockResolvedValue(
            new Response('{"error":"bad"}', {
                status: 503,
                headers: { 'content-type': 'application/json' },
            }),
        ) as unknown as typeof window.fetch;
        registerFetchTrace();

        await window.fetch('/api/rest/v1/info');

        expect(recordRestResponseMock).toHaveBeenCalled();
        expect(recordTraceErrorMock).toHaveBeenCalled();
    });

    it('records thrown fetch failures as trace errors', async () => {
        window.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof window.fetch;
        registerFetchTrace();

        await expect(window.fetch('/api/rest/v1/info')).rejects.toThrow('network down');
        expect(recordTraceErrorMock).toHaveBeenCalled();
    });

    it('records thrown Response failures', async () => {
        window.fetch = vi.fn().mockRejectedValue(
            new Response('{"error":"proxy"}', {
                status: 502,
                headers: { 'content-type': 'application/json' },
            }),
        ) as unknown as typeof window.fetch;
        registerFetchTrace();

        await expect(window.fetch('/api/rest/v1/info')).rejects.toBeInstanceOf(Response);
        expect(recordRestResponseMock).toHaveBeenCalled();
        expect(recordTraceErrorMock).toHaveBeenCalled();
    });

    it('records non-error thrown values', async () => {
        window.fetch = vi.fn().mockRejectedValue('plain-failure') as unknown as typeof window.fetch;
        registerFetchTrace();

        await expect(window.fetch('/api/rest/v1/info')).rejects.toBe('plain-failure');
        expect(recordTraceErrorMock).toHaveBeenCalled();
    });

    it('skips tracing when suppression flag is enabled', async () => {
        registerFetchTrace();

        await window.fetch('/api/rest/v1/info', { __c64uTraceSuppressed: true });

        expect(recordRestRequestMock).not.toHaveBeenCalled();
        expect(recordRestResponseMock).not.toHaveBeenCalled();
    });

    it('traces URL object inputs', async () => {
        registerFetchTrace();

        await window.fetch(new URL('http://localhost/api/rest/v1/info'));

        expect(recordRestRequestMock).toHaveBeenCalledTimes(1);
    });

    it('extracts headers and blob body from Request inputs', async () => {
        registerFetchTrace();

        const request = new Request('http://localhost/api/rest/v1/info', {
            method: 'PUT',
            headers: new Headers({ 'x-upload': '1' }),
            body: new Blob(['abc'], { type: 'text/plain' }),
        });

        await window.fetch(request);

        const payload = recordRestRequestMock.mock.calls.at(-1)?.[1] as {
            method: string;
            body: string;
        };
        expect(payload.method).toBe('PUT');
        expect(payload.body).toBe('[body]');
    });

    it('handles non-json response parsing paths without failing', async () => {
        window.fetch = vi.fn().mockResolvedValue(
            new Response('ok', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            }),
        ) as unknown as typeof window.fetch;
        registerFetchTrace();

        await window.fetch('/api/rest/v1/info', {
            method: 'POST',
            headers: [['x-test', '1']],
            body: 'not-json',
        });

        expect(recordRestRequestMock).toHaveBeenCalled();
        expect(recordRestResponseMock).toHaveBeenCalled();
    });

    it('captures form-data request bodies', async () => {
        registerFetchTrace();
        const formData = new FormData();
        formData.append('text', 'value');
        formData.append('blob', new Blob(['file-bytes'], { type: 'text/plain' }));

        await window.fetch('/api/rest/v1/info', {
            method: 'POST',
            body: formData,
        });

        const payload = recordRestRequestMock.mock.calls.at(-1)?.[1] as { body: { type: string } };
        expect(payload.body.type).toBe('form-data');
    });

    it('warns and continues when traced JSON response body is invalid', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const responseWithCloneFailure = {
            ok: true,
            status: 200,
            clone: () => {
                throw new Error('clone failed');
            },
        } as unknown as Response;
        window.fetch = vi.fn().mockResolvedValue(responseWithCloneFailure) as unknown as typeof window.fetch;
        registerFetchTrace();

        await window.fetch('/api/rest/v1/info');

        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to parse traced fetch response body',
            expect.any(Object),
        );
        expect(recordRestResponseMock).toHaveBeenCalled();
    });

    it('falls back safely when URL parsing fails', async () => {
        registerFetchTrace();

        await window.fetch('http://[::1/v1/info');

        expect(recordRestRequestMock).toHaveBeenCalled();
    });
});
