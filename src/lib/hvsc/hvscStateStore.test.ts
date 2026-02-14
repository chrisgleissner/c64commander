/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    isUpdateApplied,
    loadHvscState,
    markUpdateApplied,
    saveHvscState,
    updateHvscState,
} from './hvscStateStore';

const STORAGE_KEY = 'c64u_hvsc_state:v1';

describe('hvscStateStore', () => {
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
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('loadHvscState', () => {
        it('returns default state when localStorage is undefined', () => {
            Object.defineProperty(global, 'localStorage', {
                value: undefined,
                writable: true,
                configurable: true,
            });

            const state = loadHvscState();

            expect(state).toEqual({
                installedBaselineVersion: null,
                installedVersion: 0,
                ingestionState: 'idle',
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            });
        });

        it('returns default state when no data in localStorage', () => {
            localStorageMock.getItem.mockReturnValue(null);

            const state = loadHvscState();

            expect(state).toEqual({
                installedBaselineVersion: null,
                installedVersion: 0,
                ingestionState: 'idle',
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            });
        });

        it('returns default state when JSON parse fails', () => {
            localStorageMock.getItem.mockReturnValue('invalid json');

            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const state = loadHvscState();

            expect(state).toEqual({
                installedBaselineVersion: null,
                installedVersion: 0,
                ingestionState: 'idle',
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            });
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                'Failed to load HVSC state from storage',
                expect.objectContaining({ error: expect.any(SyntaxError) })
            );

            consoleWarnSpy.mockRestore();
        });

        it('returns default state when parsed value is null', () => {
            localStorageMock.getItem.mockReturnValue('null');

            const state = loadHvscState();

            expect(state).toEqual({
                installedBaselineVersion: null,
                installedVersion: 0,
                ingestionState: 'idle',
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            });
        });

        it('loads valid state from localStorage', () => {
            const storedState = {
                installedBaselineVersion: '1.0.0',
                installedVersion: 42,
                ingestionState: 'ready',
                lastUpdateCheckUtcMs: 1700000000000,
                ingestionError: null,
                ingestionSummary: { total: 100 },
                updates: { 1: { version: 1, status: 'success' as const } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(storedState));

            const state = loadHvscState();

            expect(state).toEqual(storedState);
        });

        it('uses default values for missing optional fields', () => {
            const partialState = {
                installedVersion: 10,
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(partialState));

            const state = loadHvscState();

            expect(state.installedBaselineVersion).toBeNull();
            expect(state.installedVersion).toBe(10);
            expect(state.ingestionState).toBe('idle');
            expect(state.lastUpdateCheckUtcMs).toBeNull();
            expect(state.ingestionError).toBeNull();
            expect(state.ingestionSummary).toBeNull();
            expect(state.updates).toEqual({});
        });

        it('normalizes invalid ingestion state to idle', () => {
            const invalidState = {
                ingestionState: 'invalid_state',
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(invalidState));

            const state = loadHvscState();

            expect(state.ingestionState).toBe('idle');
        });

        it('accepts all valid ingestion states', () => {
            const validStates = ['idle', 'installing', 'updating', 'ready', 'error'];

            for (const ingestionState of validStates) {
                localStorageMock.getItem.mockReturnValue(JSON.stringify({ ingestionState }));

                const state = loadHvscState();

                expect(state.ingestionState).toBe(ingestionState);
            }
        });
    });

    describe('saveHvscState', () => {
        it('does nothing when localStorage is undefined', () => {
            Object.defineProperty(global, 'localStorage', {
                value: undefined,
                writable: true,
                configurable: true,
            });

            expect(() => saveHvscState({ installedVersion: 1 } as any)).not.toThrow();
        });

        it('saves state to localStorage', () => {
            const state = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            };

            saveHvscState(state);

            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                STORAGE_KEY,
                JSON.stringify(state)
            );
        });
    });

    describe('updateHvscState', () => {
        it('merges partial state with current state', () => {
            const currentState = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: { 1: { version: 1, status: 'success' as const } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(currentState));

            const result = updateHvscState({ installedVersion: 10 });

            expect(result.installedVersion).toBe(10);
            expect(result.updates).toEqual(currentState.updates);
        });

        it('preserves existing updates when not provided in partial', () => {
            const currentState = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: { 1: { version: 1, status: 'success' as const } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(currentState));

            const result = updateHvscState({ ingestionState: 'ready' });

            expect(result.updates).toEqual(currentState.updates);
        });

        it('replaces updates when provided in partial', () => {
            const currentState = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: { 1: { version: 1, status: 'success' as const } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(currentState));

            const newUpdates = { 2: { version: 2, status: 'failed' as const, error: 'test error' } };
            const result = updateHvscState({ updates: newUpdates });

            expect(result.updates).toEqual(newUpdates);
        });
    });

    describe('markUpdateApplied', () => {
        it('adds successful update record', () => {
            const currentState = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(currentState));

            const result = markUpdateApplied(1, 'success');

            expect(result.updates[1]).toEqual({
                version: 1,
                status: 'success',
                error: null,
            });
        });

        it('adds failed update record with error', () => {
            const currentState = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(currentState));

            const result = markUpdateApplied(2, 'failed', 'Something went wrong');

            expect(result.updates[2]).toEqual({
                version: 2,
                status: 'failed',
                error: 'Something went wrong',
            });
        });

        it('preserves existing update records', () => {
            const currentState = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: { 1: { version: 1, status: 'success' as const, error: null } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(currentState));

            const result = markUpdateApplied(2, 'success');

            expect(result.updates[1]).toEqual({ version: 1, status: 'success', error: null });
            expect(result.updates[2]).toEqual({ version: 2, status: 'success', error: null });
        });
    });

    describe('isUpdateApplied', () => {
        it('returns true for successful update', () => {
            const state = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: { 1: { version: 1, status: 'success' as const, error: null } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(state));

            expect(isUpdateApplied(1)).toBe(true);
        });

        it('returns false for failed update', () => {
            const state = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: { 1: { version: 1, status: 'failed' as const, error: 'error' } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(state));

            expect(isUpdateApplied(1)).toBe(false);
        });

        it('returns false for unknown update', () => {
            const state = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: {},
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(state));

            expect(isUpdateApplied(999)).toBe(false);
        });

        it('returns false for update with unknown status', () => {
            const state = {
                installedBaselineVersion: null,
                installedVersion: 5,
                ingestionState: 'idle' as const,
                lastUpdateCheckUtcMs: null,
                ingestionError: null,
                ingestionSummary: null,
                updates: { 1: { version: 1, status: 'unknown' as const, error: null } },
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(state));

            expect(isUpdateApplied(1)).toBe(false);
        });
    });
});
