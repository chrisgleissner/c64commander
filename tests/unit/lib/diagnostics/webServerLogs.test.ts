import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({
    addLog: vi.fn(),
    setExternalLogs: vi.fn(),
}));

import { addLog, setExternalLogs } from '@/lib/logging';
import { startWebServerLogBridge } from '@/lib/diagnostics/webServerLogs';

describe('webServerLogs bridge', () => {
    const originalFlag = import.meta.env.VITE_WEB_PLATFORM;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        (import.meta.env as any).VITE_WEB_PLATFORM = '1';
    });

    afterEach(() => {
        (import.meta.env as any).VITE_WEB_PLATFORM = originalFlag;
        globalThis.fetch = originalFetch;
        vi.useRealTimers();
    });

    it('normalizes successful server logs and clears on dispose', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                logs: [
                    { id: '10', timestamp: '2026-03-02T11:00:00.000Z', level: 'info', message: 'ready', details: { a: 1 } },
                ],
            }),
        } as any);

        const dispose = startWebServerLogBridge();
        await vi.advanceTimersByTimeAsync(10);

        expect(setExternalLogs).toHaveBeenCalledWith([
            {
                id: 'server-10',
                timestamp: '2026-03-02T11:00:00.000Z',
                level: 'info',
                message: 'ready',
                details: { a: 1 },
            },
        ]);

        dispose();
        expect(setExternalLogs).toHaveBeenLastCalledWith([]);
    });

    it('clears server logs on unauthorized response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
        } as any);

        const dispose = startWebServerLogBridge();
        await vi.advanceTimersByTimeAsync(10);

        expect(setExternalLogs).toHaveBeenCalledWith([]);
        dispose();
    });

    it('rate-limits poll error logs to once per minute', async () => {
        const nowSpy = vi.spyOn(Date, 'now');
        nowSpy.mockReturnValue(61_000);
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom'));

        const dispose = startWebServerLogBridge();
        await vi.advanceTimersByTimeAsync(10);
        await Promise.resolve();
        expect(addLog).toHaveBeenCalledTimes(1);

        nowSpy.mockReturnValue(90_000);
        await vi.advanceTimersByTimeAsync(5000);
        await Promise.resolve();
        expect(addLog).toHaveBeenCalledTimes(1);

        nowSpy.mockReturnValue(123_000);
        await vi.advanceTimersByTimeAsync(5000);
        await Promise.resolve();
        expect(addLog).toHaveBeenCalledTimes(2);

        dispose();
        nowSpy.mockRestore();
    });
});
