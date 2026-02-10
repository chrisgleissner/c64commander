/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist the mock object so it can be used in the mock factory
const mocks = vi.hoisted(() => ({
    mockIndex: {
        load: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        scan: vi.fn(),
    }
}));

import * as hvscService from '@/lib/hvsc/hvscService';
import { Capacitor } from '@capacitor/core';
import * as runtime from '@/lib/hvsc/hvscIngestionRuntime';

// Mocks
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(),
        isPluginAvailable: vi.fn(),
    }
}));

vi.mock('@/lib/hvsc/hvscIngestionRuntime', () => ({
    addHvscProgressListener: vi.fn(),
    cancelHvscInstall: vi.fn(),
    checkForHvscUpdates: vi.fn(),
    getHvscCacheStatus: vi.fn(),
    getHvscDurationByMd5Seconds: vi.fn(),
    getHvscFolderListing: vi.fn(),
    getHvscSong: vi.fn(),
    getHvscStatus: vi.fn(),
    ingestCachedHvsc: vi.fn(),
    installOrUpdateHvsc: vi.fn(),
}));

vi.mock('@/lib/hvsc/hvscMediaIndex', () => ({
    createHvscMediaIndex: () => mocks.mockIndex
}));

vi.mock('@/lib/hvsc/hvscRootLocator', () => ({
    loadHvscRoot: vi.fn().mockReturnValue({ path: '/HVSC' })
}));

vi.mock('@/lib/hvsc/hvscSongLengthService', () => ({
    ensureHvscSonglengthsReadyOnColdStart: vi.fn(),
    resolveHvscSonglengthDuration: vi.fn().mockReturnValue({}),
}));

describe('hvscService', () => {
    // Helper to stub window but keep dispatchEvent to avoid logging errors
    const stubWindow = (overrides: Record<string, any> = {}) => {
        vi.stubGlobal('window', {
            dispatchEvent: vi.fn(),
            CustomEvent: class CustomEvent { constructor(public type: string) { } },
            ...overrides
        });
    };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.unstubAllGlobals();
    });

    describe('isHvscBridgeAvailable', () => {
        it('returns true if mock bridge exists', () => {
            stubWindow({ __hvscMock__: {} });
            expect(hvscService.isHvscBridgeAvailable()).toBe(true);
        });

        it('returns true if native platform', () => {
            stubWindow({});
            vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
            expect(hvscService.isHvscBridgeAvailable()).toBe(true);
        });

        it('returns true if Filesystem plugin available', () => {
            stubWindow({});
            vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
            vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
            expect(hvscService.isHvscBridgeAvailable()).toBe(true);
        });

        it('returns false otherwise', () => {
            stubWindow({});
            vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
            vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
            expect(hvscService.isHvscBridgeAvailable()).toBe(false);
        });
    });

    describe('getHvscStatus', () => {
        it('uses mock bridge if available', async () => {
            const mockStatus = { version: '1.0' };
            stubWindow({ __hvscMock__: { getHvscStatus: vi.fn().mockReturnValue(mockStatus) } });
            const result = await hvscService.getHvscStatus();
            expect(result).toBe(mockStatus);
        });

        it('uses runtime if no mock bridge', async () => {
            stubWindow({});
            const runtimeStatus = { version: '2.0' } as any;
            vi.mocked(runtime.getHvscStatus).mockResolvedValue(runtimeStatus);
            const result = await hvscService.getHvscStatus();
            expect(result).toBe(runtimeStatus);
            expect(runtime.getHvscStatus).toHaveBeenCalled();
        });
    });

    describe('getHvscFolderListing', () => {
        it('uses index if entries found', async () => {
            mocks.mockIndex.getAll.mockReturnValue([
                { path: '/HVSC/foo.sid', name: 'foo.sid' }
            ]);

            const result = await hvscService.getHvscFolderListing('/HVSC');

            expect(result.songs).toHaveLength(1);
            expect(result.songs[0].fileName).toBe('foo.sid');
            expect(mocks.mockIndex.load).toHaveBeenCalled();
            // Should NOT call runtime
            expect(runtime.getHvscFolderListing).not.toHaveBeenCalled();
        });

        it('falls back to mock bridge if index empty', async () => {
            mocks.mockIndex.getAll.mockReturnValue([]);
            stubWindow({
                __hvscMock__: {
                    getHvscFolderListing: vi.fn().mockReturnValue({ mock: true })
                }
            });

            const result = await hvscService.getHvscFolderListing('/path');
            expect(result).toEqual({ mock: true });
        });

        it('falls back to runtime if index empty and no mock bridge', async () => {
            mocks.mockIndex.getAll.mockReturnValue([]);
            stubWindow({});
            vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
            vi.mocked(runtime.getHvscFolderListing).mockResolvedValue({ runtime: true } as any);

            const result = await hvscService.getHvscFolderListing('/path');
            expect(result).toEqual({ runtime: true });
        });
    });

    describe('buildFolderListingFromIndex', () => {
        const { buildFolderListingFromIndex } = hvscService.__test__;

        it('groups songs and folders correctly', () => {
            const entries = [
                { path: '/HVSC/DEMOS/song.sid', name: 'song.sid' },
                { path: '/HVSC/DEMOS/nested/other.sid', name: 'other.sid' },
                { path: '/HVSC/GAMES/game.sid', name: 'game.sid' },
            ];

            const listing = buildFolderListingFromIndex('/HVSC/DEMOS', entries);

            expect(listing.path).toBe('/HVSC/DEMOS');
            expect(listing.folders).toContain('/HVSC/DEMOS/nested');
            expect(listing.songs).toHaveLength(1);
            expect(listing.songs[0].fileName).toBe('song.sid');
        });
    });
});
