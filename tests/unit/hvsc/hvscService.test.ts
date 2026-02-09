import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
        isPluginAvailable: vi.fn(() => false),
    },
}));

vi.mock('@/lib/hvsc/hvscIngestionRuntime', () => ({
    addHvscProgressListener: vi.fn(async (listener: any) => ({ remove: async () => { } })),
    cancelHvscInstall: vi.fn(async () => undefined),
    checkForHvscUpdates: vi.fn(async () => ({ latestVersion: 84, installedVersion: 83, baselineVersion: 83, requiredUpdates: [84] })),
    getHvscCacheStatus: vi.fn(async () => ({ baselineVersion: 83, updateVersions: [84] })),
    getHvscDurationByMd5Seconds: vi.fn(async () => 42),
    getHvscFolderListing: vi.fn(async () => ({ path: '/', folders: [], songs: [] })),
    getHvscSong: vi.fn(async () => ({ id: 1, virtualPath: '/test.sid', fileName: 'test.sid', durationSeconds: 42, durationsSeconds: null, subsongCount: null, md5: null, dataBase64: 'AA==' })),
    getHvscStatus: vi.fn(async () => ({ ingestionState: 'idle', ingestionError: null, installedVersion: 83 })),
    ingestCachedHvsc: vi.fn(async () => ({ ingestionState: 'ready', ingestionError: null, installedVersion: 83 })),
    installOrUpdateHvsc: vi.fn(async () => ({ ingestionState: 'ready', ingestionError: null, installedVersion: 84 })),
}));

vi.mock('@/lib/hvsc/hvscMediaIndex', () => ({
    createHvscMediaIndex: vi.fn(() => ({
        load: vi.fn(async () => undefined),
        getAll: vi.fn(() => []),
        scan: vi.fn(async () => undefined),
    })),
}));

vi.mock('@/lib/hvsc/hvscRootLocator', () => ({
    loadHvscRoot: vi.fn(() => ({ path: '/', label: 'HVSC Library' })),
}));

vi.mock('@/lib/hvsc/hvscSongLengthService', () => ({
    ensureHvscSonglengthsReadyOnColdStart: vi.fn(async () => undefined),
    resolveHvscSonglengthDuration: vi.fn(async () => ({ durationSeconds: 42, durations: null, subsongCount: null })),
}));

vi.mock('@/lib/sourceNavigation/paths', () => ({
    normalizeSourcePath: vi.fn((p: string) => p || '/'),
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

import { Capacitor } from '@capacitor/core';
import {
    isHvscBridgeAvailable,
    getHvscStatus,
    getHvscCacheStatus,
    checkForHvscUpdates,
    installOrUpdateHvsc,
    ingestCachedHvsc,
    cancelHvscInstall,
    addHvscProgressListener,
    getHvscFolderListing,
    getHvscSong,
    getHvscDurationByMd5Seconds,
    getHvscDurationsByMd5Seconds,
    resolveHvscSonglength,
    __test__,
} from '@/lib/hvsc/hvscService';
import {
    getHvscStatus as getRuntimeStatus,
    getHvscFolderListing as getRuntimeFolderListing,
} from '@/lib/hvsc/hvscIngestionRuntime';
import { resolveHvscSonglengthDuration } from '@/lib/hvsc/hvscSongLengthService';

describe('hvscService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Remove mock bridge if present
        delete (window as any).__hvscMock__;
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
        vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    });

    describe('isHvscBridgeAvailable', () => {
        it('returns true when mock bridge is present', () => {
            (window as any).__hvscMock__ = { getHvscStatus: vi.fn() };
            expect(isHvscBridgeAvailable()).toBe(true);
        });

        it('returns true when Capacitor Filesystem is available', () => {
            vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
            expect(isHvscBridgeAvailable()).toBe(true);
        });

        it('returns false when neither bridge is available', () => {
            expect(isHvscBridgeAvailable()).toBe(false);
        });
    });

    describe('runtime dispatch', () => {
        it('getHvscStatus delegates to runtime', async () => {
            const status = await getHvscStatus();
            expect(status.ingestionState).toBe('idle');
            expect(getRuntimeStatus).toHaveBeenCalled();
        });

        it('getHvscCacheStatus delegates to runtime', async () => {
            const cache = await getHvscCacheStatus();
            expect(cache.baselineVersion).toBe(83);
        });

        it('checkForHvscUpdates delegates to runtime', async () => {
            const updates = await checkForHvscUpdates();
            expect(updates.latestVersion).toBe(84);
        });

        it('installOrUpdateHvsc delegates to runtime', async () => {
            const status = await installOrUpdateHvsc('token-1');
            expect(status.installedVersion).toBe(84);
        });

        it('ingestCachedHvsc delegates to runtime', async () => {
            const status = await ingestCachedHvsc('token-2');
            expect(status.installedVersion).toBe(83);
        });

        it('cancelHvscInstall delegates to runtime', async () => {
            await cancelHvscInstall('token-3');
        });

        it('addHvscProgressListener delegates to runtime', async () => {
            const listener = vi.fn();
            const sub = await addHvscProgressListener(listener);
            expect(sub.remove).toBeDefined();
        });

        it('getHvscSong delegates to runtime', async () => {
            const song = await getHvscSong({ virtualPath: '/test.sid' });
            expect(song.fileName).toBe('test.sid');
        });

        it('getHvscDurationByMd5Seconds delegates to runtime', async () => {
            const duration = await getHvscDurationByMd5Seconds('abc123');
            expect(duration).toBe(42);
        });
    });

    describe('mock bridge dispatch', () => {
        it('getHvscStatus dispatches to mock bridge when present', async () => {
            const mockGetStatus = vi.fn().mockResolvedValue({ ingestionState: 'ready', installedVersion: 99 });
            (window as any).__hvscMock__ = { getHvscStatus: mockGetStatus };

            const status = await getHvscStatus();
            expect(status.installedVersion).toBe(99);
            expect(mockGetStatus).toHaveBeenCalled();
            expect(getRuntimeStatus).not.toHaveBeenCalled();
        });

        it('getHvscSong dispatches to mock bridge when present', async () => {
            const mockGetSong = vi.fn().mockResolvedValue({ id: 1, virtualPath: '/mock.sid', fileName: 'mock.sid', durationSeconds: 10 });
            (window as any).__hvscMock__ = { getHvscSong: mockGetSong };

            const song = await getHvscSong({ virtualPath: '/mock.sid' });
            expect(song.fileName).toBe('mock.sid');
        });
    });

    describe('getHvscFolderListing', () => {
        it('falls back to runtime when index is empty and bridge is available', async () => {
            vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
            const result = await getHvscFolderListing('/');
            expect(getRuntimeFolderListing).toHaveBeenCalledWith('/');
        });

        it('returns empty listing from index when bridge is unavailable', async () => {
            const result = await getHvscFolderListing('/');
            expect(getRuntimeFolderListing).not.toHaveBeenCalled();
            expect(result).toEqual({ path: '/', folders: [], songs: [] });
        });
    });

    describe('buildFolderListingFromIndex', () => {
        it('builds folder listing with folder and song data', () => {
            const entries = [
                { path: '/DEMOS/0-9/35_Years.sid', name: '35_Years.sid', durationSeconds: 161 },
                { path: '/MUSICIANS/Rob_Hubbard/Commando.sid', name: 'Commando.sid', durationSeconds: 120 },
            ];

            const listing = __test__.buildFolderListingFromIndex('/DEMOS/0-9', entries);

            expect(listing.path).toBe('/DEMOS/0-9');
            expect(listing.folders).toEqual(['/DEMOS/0-9', '/MUSICIANS/Rob_Hubbard']);
            expect(listing.songs).toHaveLength(1);
            expect(listing.songs[0]).toMatchObject({
                virtualPath: '/DEMOS/0-9/35_Years.sid',
                fileName: '35_Years.sid',
                durationSeconds: 161,
            });
        });
    });

    describe('getHvscDurationsByMd5Seconds', () => {
        it('delegates to songlength resolution when no mock bridge', async () => {
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({
                durationSeconds: 42,
                durations: [42, 55],
                subsongCount: 2,
            });

            const result = await getHvscDurationsByMd5Seconds('abc123');
            expect(result).toEqual([42, 55]);
        });

        it('returns single-element array when only durationSeconds available', async () => {
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({
                durationSeconds: 42,
                durations: null,
                subsongCount: null,
            });

            const result = await getHvscDurationsByMd5Seconds('abc123');
            expect(result).toEqual([42]);
        });

        it('returns null when no duration available', async () => {
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({
                durationSeconds: null,
                durations: null,
                subsongCount: null,
            });

            const result = await getHvscDurationsByMd5Seconds('abc123');
            expect(result).toBeNull();
        });

        it('uses mock bridge when present', async () => {
            const mockDurations = vi.fn().mockResolvedValue({ durationsSeconds: [10, 20, 30] });
            (window as any).__hvscMock__ = { getHvscDurationsByMd5: mockDurations };

            const result = await getHvscDurationsByMd5Seconds('abc123');
            expect(result).toEqual([10, 20, 30]);
        });
    });

    describe('resolveHvscSonglength', () => {
        it('delegates to songlength resolution when no mock bridge', async () => {
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({
                durationSeconds: 42,
                durations: null,
                subsongCount: null,
            });

            const result = await resolveHvscSonglength({ virtualPath: '/test.sid' });
            expect(result.durationSeconds).toBe(42);
        });
    });
});
