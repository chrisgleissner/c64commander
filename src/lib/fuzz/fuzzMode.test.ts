/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('fuzzMode', () => {
    let localStorageMock: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
    let sessionStorageMock: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        localStorageMock = {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
        };
        sessionStorageMock = {
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
        Object.defineProperty(global, 'sessionStorage', {
            value: sessionStorageMock,
            writable: true,
            configurable: true,
        });
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetModules();
        delete (window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode;
    });

    describe('isFuzzModeEnabled', () => {
        it('returns false when no fuzz mode indicators are set', async () => {
            localStorageMock.getItem.mockReturnValue(null);
            const { isFuzzModeEnabled } = await import('./fuzzMode');
            expect(isFuzzModeEnabled()).toBe(false);
        });

        it('returns true when localStorage has fuzz mode enabled', async () => {
            localStorageMock.getItem.mockReturnValue('1');
            const { isFuzzModeEnabled } = await import('./fuzzMode');
            expect(isFuzzModeEnabled()).toBe(true);
        });

        it('returns true when window.__c64uFuzzMode is set', async () => {
            (window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode = true;
            const { isFuzzModeEnabled } = await import('./fuzzMode');
            expect(isFuzzModeEnabled()).toBe(true);
        });

        it('returns false when localStorage value is not "1"', async () => {
            localStorageMock.getItem.mockReturnValue('0');
            const { isFuzzModeEnabled } = await import('./fuzzMode');
            expect(isFuzzModeEnabled()).toBe(false);
        });
    });

    describe('getFuzzMockBaseUrl', () => {
        it('returns null when no base URL is set', async () => {
            localStorageMock.getItem.mockReturnValue(null);
            const { getFuzzMockBaseUrl } = await import('./fuzzMode');
            expect(getFuzzMockBaseUrl()).toBeNull();
        });

        it('returns the base URL when set', async () => {
            localStorageMock.getItem.mockReturnValue('http://localhost:8080');
            const { getFuzzMockBaseUrl } = await import('./fuzzMode');
            expect(getFuzzMockBaseUrl()).toBe('http://localhost:8080');
        });
    });

    describe('markFuzzModeEnabled', () => {
        it('sets fuzz mode in localStorage', async () => {
            const { markFuzzModeEnabled } = await import('./fuzzMode');
            markFuzzModeEnabled();
            expect(localStorageMock.setItem).toHaveBeenCalledWith('c64u_fuzz_mode_enabled', '1');
        });

        it('does nothing when localStorage is undefined', async () => {
            Object.defineProperty(global, 'localStorage', {
                value: undefined,
                writable: true,
                configurable: true,
            });
            const { markFuzzModeEnabled } = await import('./fuzzMode');
            expect(() => markFuzzModeEnabled()).not.toThrow();
        });
    });

    describe('resetFuzzStorage', () => {
        it('does nothing when fuzz mode is not enabled', async () => {
            localStorageMock.getItem.mockReturnValue(null);
            const { resetFuzzStorage } = await import('./fuzzMode');
            resetFuzzStorage();
            expect(localStorageMock.clear).not.toHaveBeenCalled();
        });

        it('clears storage when fuzz mode is enabled', async () => {
            localStorageMock.getItem.mockImplementation((key: string) => {
                if (key === 'c64u_fuzz_mode_enabled') return '1';
                if (key === 'c64u_fuzz_storage_seeded') return null;
                return null;
            });
            const { resetFuzzStorage } = await import('./fuzzMode');
            resetFuzzStorage();
            expect(localStorageMock.clear).toHaveBeenCalled();
            expect(sessionStorageMock.clear).toHaveBeenCalled();
        });

        it('preserves fuzz mock base URL when clearing', async () => {
            localStorageMock.getItem.mockImplementation((key: string) => {
                if (key === 'c64u_fuzz_mode_enabled') return '1';
                if (key === 'c64u_fuzz_storage_seeded') return null;
                if (key === 'c64u_fuzz_mock_base_url') return 'http://localhost:3000';
                return null;
            });
            const { resetFuzzStorage } = await import('./fuzzMode');
            resetFuzzStorage();
            expect(localStorageMock.setItem).toHaveBeenCalledWith('c64u_fuzz_mock_base_url', 'http://localhost:3000');
        });

        it('does not clear if already seeded', async () => {
            localStorageMock.getItem.mockImplementation((key: string) => {
                if (key === 'c64u_fuzz_mode_enabled') return '1';
                if (key === 'c64u_fuzz_storage_seeded') return '1';
                return null;
            });
            const { resetFuzzStorage } = await import('./fuzzMode');
            resetFuzzStorage();
            expect(localStorageMock.clear).not.toHaveBeenCalled();
        });
    });

    describe('applyFuzzModeDefaults', () => {
        it('does nothing when fuzz mode is not enabled', async () => {
            localStorageMock.getItem.mockReturnValue(null);
            const { applyFuzzModeDefaults } = await import('./fuzzMode');
            applyFuzzModeDefaults();
            expect(localStorageMock.setItem).not.toHaveBeenCalled();
        });

        it('applies defaults when fuzz mode is enabled', async () => {
            localStorageMock.getItem.mockImplementation((key: string) => {
                if (key === 'c64u_fuzz_mode_enabled') return '1';
                if (key === 'c64u_fuzz_storage_seeded') return null;
                return null;
            });
            const { applyFuzzModeDefaults } = await import('./fuzzMode');
            applyFuzzModeDefaults();
            expect(localStorageMock.setItem).toHaveBeenCalledWith('c64u_fuzz_storage_seeded', '1');
            expect(localStorageMock.setItem).toHaveBeenCalledWith('c64u_debug_logging_enabled', '1');
            expect(localStorageMock.setItem).toHaveBeenCalledWith('c64u_automatic_demo_mode_enabled', '1');
        });
    });
});
