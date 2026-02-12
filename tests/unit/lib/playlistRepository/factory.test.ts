import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/native/platform', () => ({
    isNativePlatform: vi.fn(),
}));

vi.mock('@/lib/playlistRepository/localStorageRepository', () => {
    const localRepository = { id: 'local' };
    return {
        getLocalStoragePlaylistDataRepository: vi.fn(() => localRepository),
    };
});

vi.mock('@/lib/playlistRepository/indexedDbRepository', () => {
    const indexedDbRepository = { id: 'indexeddb' };
    return {
        getIndexedDbPlaylistDataRepository: vi.fn(() => indexedDbRepository),
    };
});

import { isNativePlatform } from '@/lib/native/platform';
import { getIndexedDbPlaylistDataRepository } from '@/lib/playlistRepository/indexedDbRepository';
import { getLocalStoragePlaylistDataRepository } from '@/lib/playlistRepository/localStorageRepository';
import { getPlaylistDataRepository, resetPlaylistDataRepositoryForTests } from '@/lib/playlistRepository/factory';

describe('playlist repository factory', () => {
    beforeEach(() => {
        resetPlaylistDataRepositoryForTests();
        vi.clearAllMocks();
    });

    it('uses IndexedDB repository on native platforms when indexedDB is available', () => {
        vi.mocked(isNativePlatform).mockReturnValue(true);
        Object.defineProperty(globalThis, 'indexedDB', {
            value: {},
            configurable: true,
            writable: true,
        });

        const repository = getPlaylistDataRepository();

        expect(getIndexedDbPlaylistDataRepository).toHaveBeenCalledWith({ preferDurableStorage: true });
        expect(getLocalStoragePlaylistDataRepository).not.toHaveBeenCalled();
        expect(repository).toEqual({ id: 'indexeddb' });
    });

    it('falls back to localStorage repository when indexedDB is unavailable', () => {
        vi.mocked(isNativePlatform).mockReturnValue(true);
        Object.defineProperty(globalThis, 'indexedDB', {
            value: undefined,
            configurable: true,
            writable: true,
        });

        const repository = getPlaylistDataRepository();

        expect(getLocalStoragePlaylistDataRepository).toHaveBeenCalledTimes(1);
        expect(getIndexedDbPlaylistDataRepository).not.toHaveBeenCalled();
        expect(repository).toEqual({ id: 'local' });
    });

    it('falls back to localStorage repository on non-native platforms and caches instance until reset', () => {
        vi.mocked(isNativePlatform).mockReturnValue(false);
        Object.defineProperty(globalThis, 'indexedDB', {
            value: {},
            configurable: true,
            writable: true,
        });

        const first = getPlaylistDataRepository();
        const second = getPlaylistDataRepository();

        expect(first).toBe(second);
        expect(getLocalStoragePlaylistDataRepository).toHaveBeenCalledTimes(1);

        resetPlaylistDataRepositoryForTests();
        const third = getPlaylistDataRepository();
        expect(third).toEqual({ id: 'local' });
        expect(getLocalStoragePlaylistDataRepository).toHaveBeenCalledTimes(2);
    });
});
