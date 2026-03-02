import { describe, expect, it, vi } from 'vitest';
import { buildNetworkSnapshot } from '@/lib/diagnostics/networkSnapshot';

vi.mock('@/lib/tracing/traceSession', () => ({
    getTraceEvents: vi.fn(),
}));

import { getTraceEvents } from '@/lib/tracing/traceSession';

const ctx = {
    lifecycleState: 'foreground',
    sourceKind: null,
    localAccessMode: null,
    trackInstanceId: null,
    playlistItemId: null,
} as const;

describe('networkSnapshot', () => {
    it('summarizes successful and failed REST requests', () => {
        vi.mocked(getTraceEvents).mockReturnValue([
            {
                id: '1',
                timestamp: '2026-03-02T10:00:00.000Z',
                relativeMs: 1,
                type: 'rest-request',
                origin: 'user',
                correlationId: 'a',
                data: { ...ctx, url: 'https://example.com/v1/version', method: 'GET' },
            },
            {
                id: '2',
                timestamp: '2026-03-02T10:00:00.200Z',
                relativeMs: 2,
                type: 'rest-response',
                origin: 'user',
                correlationId: 'a',
                data: { ...ctx, status: 200, durationMs: 200 },
            },
            {
                id: '3',
                timestamp: '2026-03-02T10:00:01.000Z',
                relativeMs: 3,
                type: 'rest-request',
                origin: 'system',
                correlationId: 'b',
                data: { ...ctx, url: 'not-a-url', method: 'POST' },
            },
            {
                id: '4',
                timestamp: '2026-03-02T10:00:01.500Z',
                relativeMs: 4,
                type: 'rest-response',
                origin: 'system',
                correlationId: 'b',
                data: {
                    ...ctx,
                    status: 500,
                    durationMs: 500,
                    error: { name: 'FetchError', code: 'ECONNREFUSED', message: 'connect refused' },
                },
            },
        ] as any);

        const snapshot = buildNetworkSnapshot();
        expect(snapshot.successCount).toBe(1);
        expect(snapshot.failureCount).toBe(1);
        expect(snapshot.requests).toHaveLength(2);

        expect(snapshot.requests[0]).toMatchObject({
            hostname: 'example.com',
            protocol: 'https',
            port: 443,
            httpStatus: 200,
            method: 'GET',
        });

        expect(snapshot.requests[1]).toMatchObject({
            hostname: null,
            protocol: null,
            port: null,
            httpStatus: 500,
            errorDomain: 'FetchError',
            errorCode: 'ECONNREFUSED',
            errorMessage: 'connect refused',
        });
    });

    it('handles unmatched requests and responses deterministically', () => {
        vi.mocked(getTraceEvents).mockReturnValue([
            {
                id: '1',
                timestamp: '2026-03-02T10:00:00.000Z',
                relativeMs: 1,
                type: 'rest-request',
                origin: 'user',
                correlationId: 'req-only',
                data: { ...ctx, url: 'http://localhost:8080/ping', method: 'PUT' },
            },
            {
                id: '2',
                timestamp: '2026-03-02T10:00:00.900Z',
                relativeMs: 2,
                type: 'rest-response',
                origin: 'user',
                correlationId: 'res-only',
                data: { ...ctx, status: 204 },
            },
        ] as any);

        const snapshot = buildNetworkSnapshot();
        expect(snapshot.successCount).toBe(1);
        expect(snapshot.failureCount).toBe(0);
        expect(snapshot.requests).toHaveLength(2);

        const reqOnly = snapshot.requests.find((entry) => entry.method === 'PUT');
        expect(reqOnly).toMatchObject({
            hostname: 'localhost',
            resolvedIp: '127.0.0.1',
            port: 8080,
            httpStatus: null,
            timestamp: '2026-03-02T10:00:00.000Z',
        });

        const resOnly = snapshot.requests.find((entry) => entry.method === 'GET' && entry.httpStatus === 204);
        expect(resOnly?.timestamp).toBe('2026-03-02T10:00:00.900Z');
    });
});
