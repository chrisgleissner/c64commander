/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const addListenerMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn(async () => undefined));
const loggerMocks = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn(() => ({
        addListener: addListenerMock,
    })),
}));

vi.mock('@/lib/diagnostics/logger', () => ({
    logger: loggerMocks,
}));

describe('native diagnostics bridge', () => {
    beforeEach(() => {
        vi.resetModules();
        addListenerMock.mockReset();
        removeMock.mockReset();
        loggerMocks.debug.mockReset();
        loggerMocks.info.mockReset();
        loggerMocks.warn.mockReset();
        loggerMocks.error.mockReset();
        removeMock.mockResolvedValue(undefined);
    });

    it('maps native log levels to logger methods and defaults origin', async () => {
        let listener: ((event: { level?: 'debug' | 'info' | 'warn' | 'error'; message: string; details?: Record<string, unknown> }) => void) | null = null;
        addListenerMock.mockImplementation(async (_eventName, cb) => {
            listener = cb;
            return { remove: removeMock };
        });

        const { startNativeDiagnosticsBridge } = await import('@/lib/native/diagnosticsBridge');
        await startNativeDiagnosticsBridge();

        expect(addListenerMock).toHaveBeenCalledTimes(1);
        listener?.({ level: 'warn', message: 'warn message', details: { code: 1 } });
        listener?.({ level: 'error', message: 'error message', details: { code: 2 } });
        listener?.({ level: 'debug', message: 'debug message', details: { code: 3 } });
        listener?.({ message: 'info fallback', details: { code: 4 } });

        expect(loggerMocks.warn).toHaveBeenCalledWith('warn message', expect.objectContaining({
            component: 'native',
            includeConsole: false,
            details: expect.objectContaining({ origin: 'native', code: 1 }),
        }));
        expect(loggerMocks.error).toHaveBeenCalledWith('error message', expect.objectContaining({
            component: 'native',
            includeConsole: false,
            details: expect.objectContaining({ origin: 'native', code: 2 }),
        }));
        expect(loggerMocks.debug).toHaveBeenCalledWith('debug message', expect.objectContaining({
            component: 'native',
            includeConsole: false,
            details: expect.objectContaining({ origin: 'native', code: 3 }),
        }));
        expect(loggerMocks.info).toHaveBeenCalledWith('info fallback', expect.objectContaining({
            component: 'native',
            includeConsole: false,
            details: expect.objectContaining({ origin: 'native', code: 4 }),
        }));
    });

    it('does not overwrite explicit origin from native payload', async () => {
        let listener: ((event: { level?: 'debug' | 'info' | 'warn' | 'error'; message: string; details?: Record<string, unknown> }) => void) | null = null;
        addListenerMock.mockImplementation(async (_eventName, cb) => {
            listener = cb;
            return { remove: removeMock };
        });

        const { startNativeDiagnosticsBridge } = await import('@/lib/native/diagnosticsBridge');
        await startNativeDiagnosticsBridge();

        listener?.({
            level: 'info',
            message: 'info with explicit origin',
            details: { origin: 'ios-native' },
        });

        expect(loggerMocks.info).toHaveBeenCalledWith('info with explicit origin', expect.objectContaining({
            details: expect.objectContaining({ origin: 'ios-native' }),
        }));
    });

    it('does not re-subscribe when already started and cleans up on stop', async () => {
        addListenerMock.mockResolvedValue({ remove: removeMock });
        const { startNativeDiagnosticsBridge, stopNativeDiagnosticsBridge } = await import('@/lib/native/diagnosticsBridge');

        await startNativeDiagnosticsBridge();
        await startNativeDiagnosticsBridge();

        expect(addListenerMock).toHaveBeenCalledTimes(1);

        await stopNativeDiagnosticsBridge();
        expect(removeMock).toHaveBeenCalledTimes(1);

        await stopNativeDiagnosticsBridge();
        expect(removeMock).toHaveBeenCalledTimes(1);
    });

    it('logs warning when native DiagnosticsBridge is unavailable', async () => {
        addListenerMock.mockRejectedValue(new Error('plugin unavailable'));
        const { startNativeDiagnosticsBridge } = await import('@/lib/native/diagnosticsBridge');

        await startNativeDiagnosticsBridge();

        expect(loggerMocks.warn).toHaveBeenCalledWith(
            'DiagnosticsBridge unavailable; native diagnostics mirroring disabled',
            expect.objectContaining({
                component: 'native',
                includeConsole: false,
                details: expect.objectContaining({ origin: 'native', error: expect.any(Error) }),
            }),
        );
    });
});
