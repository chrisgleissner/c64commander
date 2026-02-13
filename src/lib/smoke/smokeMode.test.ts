/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Capacitor before importing smokeMode
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
    },
}));

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
    },
    Directory: {
        Data: 'Data',
    },
    Encoding: {
        UTF8: 'utf8',
    },
}));

vi.mock('@/lib/logging', () => ({
    addLog: vi.fn(),
}));

vi.mock('@/lib/config/appSettings', () => ({
    saveDebugLoggingEnabled: vi.fn(),
}));

vi.mock('@/lib/c64api', () => ({
    normalizeDeviceHost: vi.fn((host: string) => host.replace(/\/$/, '')),
}));

describe('smokeMode', () => {
    let localStorageMock: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        localStorageMock = {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
        };
        Object.defineProperty(global, 'localStorage', {
            value: localStorageMock,
            writable: true,
            configurable: true,
        });
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetModules();
    });

    describe('isSmokeModeEnabled', () => {
        it('returns false when no config is cached', async () => {
            const { isSmokeModeEnabled } = await import('./smokeMode');
            expect(isSmokeModeEnabled()).toBe(false);
        });
    });

    describe('getSmokeConfig', () => {
        it('returns null when no config is cached', async () => {
            const { getSmokeConfig } = await import('./smokeMode');
            expect(getSmokeConfig()).toBeNull();
        });
    });

    describe('isSmokeReadOnlyEnabled', () => {
        it('returns true when no config is cached', async () => {
            const { isSmokeReadOnlyEnabled } = await import('./smokeMode');
            expect(isSmokeReadOnlyEnabled()).toBe(true);
        });
    });

    describe('initializeSmokeMode', () => {
        it('returns null when no config in storage', async () => {
            localStorageMock.getItem.mockReturnValue(null);
            const { initializeSmokeMode } = await import('./smokeMode');
            const result = await initializeSmokeMode();
            expect(result).toBeNull();
        });

        it('returns null when localStorage is undefined', async () => {
            Object.defineProperty(global, 'localStorage', {
                value: undefined,
                writable: true,
                configurable: true,
            });
            const { initializeSmokeMode } = await import('./smokeMode');
            const result = await initializeSmokeMode();
            expect(result).toBeNull();
        });

        it('loads config from localStorage', async () => {
            const configJson = JSON.stringify({
                target: 'mock',
                readOnly: false,
                debugLogging: true,
            });
            localStorageMock.getItem.mockReturnValue(configJson);

            const { initializeSmokeMode, getSmokeConfig } = await import('./smokeMode');
            const result = await initializeSmokeMode();

            expect(result).not.toBeNull();
            expect(result?.target).toBe('mock');
            expect(result?.readOnly).toBe(false);
            expect(getSmokeConfig()).toEqual(result);
        });

        it('handles invalid JSON in localStorage', async () => {
            localStorageMock.getItem.mockReturnValue('invalid json');

            const { addLog } = await import('@/lib/logging');
            const { initializeSmokeMode } = await import('./smokeMode');
            const result = await initializeSmokeMode();

            expect(result).toBeNull();
            expect(addLog).toHaveBeenCalledWith('warn', 'Failed to parse smoke config from storage', expect.any(Object));
        });

        it('handles invalid config structure', async () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify({ target: 'invalid' }));

            const { initializeSmokeMode } = await import('./smokeMode');
            const result = await initializeSmokeMode();

            expect(result).toBeNull();
        });

        it('enables debug logging when configured', async () => {
            const configJson = JSON.stringify({
                target: 'mock',
                debugLogging: true,
            });
            localStorageMock.getItem.mockReturnValue(configJson);

            const { saveDebugLoggingEnabled } = await import('@/lib/config/appSettings');
            const { initializeSmokeMode } = await import('./smokeMode');
            await initializeSmokeMode();

            expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
        });

        it('sets device host when configured', async () => {
            const configJson = JSON.stringify({
                target: 'real',
                host: '192.168.1.100/',
            });
            localStorageMock.getItem.mockReturnValue(configJson);

            const { initializeSmokeMode } = await import('./smokeMode');
            await initializeSmokeMode();

            expect(localStorageMock.setItem).toHaveBeenCalledWith('c64u_device_host', '192.168.1.100');
        });
    });

    describe('recordSmokeStatus', () => {
        it('does nothing when no config cached', async () => {
            const { recordSmokeStatus } = await import('./smokeMode');
            await recordSmokeStatus({ state: 'test' });
            // Should not throw
        });
    });
});
