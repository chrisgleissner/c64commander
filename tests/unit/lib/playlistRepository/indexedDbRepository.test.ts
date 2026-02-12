import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getIndexedDbPlaylistDataRepository } from '@/lib/playlistRepository';
import { resetIndexedDbPlaylistRepositoryForTests } from '@/lib/playlistRepository/indexedDbRepository';
import type { PlaylistItemRecord, TrackRecord } from '@/lib/playlistRepository';

type FakeIndexedDbOptions = {
    failOpen?: boolean;
    failGet?: boolean;
    failPut?: boolean;
    failGetWithoutError?: boolean;
    failPutWithoutError?: boolean;
    preExistingStore?: boolean;
    initialPersistedState?: unknown;
};

const createFakeIndexedDb = (options: FakeIndexedDbOptions = {}) => {
    const stores = new Map<string, Map<string, unknown>>();
    if (options.preExistingStore) {
        stores.set('state', new Map());
    }
    let upgraded = false;

    const objectStoreNames = {
        contains: (name: string) => stores.has(name),
    };

    const ensureStore = (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return stores.get(name)!;
    };

    const db = {
        objectStoreNames,
        createObjectStore: (name: string) => {
            ensureStore(name);
            return {};
        },
        transaction: (storeName: string) => ({
            objectStore: () => ({
                get: (key: string) => {
                    const request: Record<string, unknown> = {};
                    queueMicrotask(() => {
                        if (options.failGet) {
                            request.error = options.failGetWithoutError ? null : new Error('fake get failure');
                            (request.onerror as (() => void) | undefined)?.();
                            return;
                        }
                        request.result = ensureStore(storeName).get(key);
                        (request.onsuccess as (() => void) | undefined)?.();
                    });
                    return request;
                },
                put: (value: unknown, key: string) => {
                    const request: Record<string, unknown> = {};
                    queueMicrotask(() => {
                        if (options.failPut) {
                            request.error = options.failPutWithoutError ? null : new Error('fake put failure');
                            (request.onerror as (() => void) | undefined)?.();
                            return;
                        }
                        ensureStore(storeName).set(key, value);
                        request.result = key;
                        (request.onsuccess as (() => void) | undefined)?.();
                    });
                    return request;
                },
            }),
        }),
        close: () => { },
    };

    return {
        open: () => {
            const request: Record<string, unknown> = {};
            queueMicrotask(() => {
                if (options.failOpen) {
                    request.error = new Error('fake open failure');
                    (request.onerror as (() => void) | undefined)?.();
                    return;
                }
                request.result = db;
                if (!upgraded) {
                    upgraded = true;
                    (request.onupgradeneeded as (() => void) | undefined)?.();
                    if (options.initialPersistedState !== undefined) {
                        ensureStore('state').set('playlist-repository-state', options.initialPersistedState);
                    }
                }
                (request.onsuccess as (() => void) | undefined)?.();
            });
            return request;
        },
    } as IDBFactory;
};

const buildTrack = (overrides: Partial<TrackRecord> = {}): TrackRecord => ({
    trackId: overrides.trackId ?? 'track-1',
    sourceKind: overrides.sourceKind ?? 'local',
    sourceLocator: overrides.sourceLocator ?? '/music/a.sid',
    category: overrides.category ?? 'song',
    title: overrides.title ?? 'A',
    author: overrides.author ?? null,
    released: overrides.released ?? null,
    path: overrides.path ?? '/music/a.sid',
    sizeBytes: overrides.sizeBytes ?? null,
    modifiedAt: overrides.modifiedAt ?? null,
    defaultDurationMs: overrides.defaultDurationMs ?? 1000,
    subsongCount: overrides.subsongCount ?? 1,
    createdAt: overrides.createdAt ?? '2026-02-12T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-02-12T00:00:00.000Z',
});

const buildItem = (playlistItemId: string, trackId: string, sortKey: string): PlaylistItemRecord => ({
    playlistItemId,
    playlistId: 'playlist-default',
    trackId,
    songNr: 1,
    sortKey,
    durationOverrideMs: null,
    status: 'ready',
    unavailableReason: null,
    addedAt: '2026-02-12T00:00:00.000Z',
});

describe('indexedDB playlist repository', () => {
    beforeEach(() => {
        resetIndexedDbPlaylistRepositoryForTests();
        vi.restoreAllMocks();
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb(),
            configurable: true,
            writable: true,
        });
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                storage: {
                    persist: vi.fn().mockResolvedValue(true),
                },
            },
            configurable: true,
            writable: true,
        });
    });

    it('persists tracks and supports query sorting and category filtering', async () => {
        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: true });

        await repository.upsertTracks([
            buildTrack({ trackId: 'track-a', title: 'Alpha', path: '/a.sid', sourceLocator: '/a.sid', category: 'song' }),
            buildTrack({ trackId: 'track-b', title: 'Beta', path: '/b.prg', sourceLocator: '/b.prg', category: 'program' }),
            buildTrack({ trackId: 'track-c', title: 'Gamma', path: '/c.sid', sourceLocator: '/c.sid', category: 'song' }),
        ]);

        await repository.replacePlaylistItems('playlist-default', [
            buildItem('item-2', 'track-b', '0002'),
            buildItem('item-1', 'track-a', '0001'),
            buildItem('item-3', 'track-c', '0003'),
        ]);

        const titleSorted = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            query: 'a',
            limit: 10,
            offset: 0,
            sort: 'title',
        });
        expect(titleSorted.totalMatchCount).toBe(3);

        const pathSortedSongs = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            categoryFilter: ['song'],
            limit: 10,
            offset: 0,
            sort: 'path',
        });
        expect(pathSortedSongs.rows.map((row) => row.playlistItem.playlistItemId)).toEqual(['item-1', 'item-3']);

        const tracks = await repository.getTracksByIds(['track-a', 'track-b', 'missing']);
        expect(tracks.has('track-a')).toBe(true);
        expect(tracks.has('missing')).toBe(false);
    });

    it('creates random sessions, advances cursor, and wraps around', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1730000000000);
        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });

        const created = await repository.createSession('playlist-default', ['item-1', 'item-2', 'item-3']);
        expect(created.order).toHaveLength(3);

        const first = await repository.next('playlist-default');
        const second = await repository.next('playlist-default');
        const third = await repository.next('playlist-default');
        const fourth = await repository.next('playlist-default');

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(third).not.toBeNull();
        expect(fourth).toBe(first);

        const saved = await repository.getRandomSession('playlist-default');
        expect(saved?.order).toEqual(created.order);

        await repository.saveRandomSession({ playlistId: 'playlist-default', seed: 1, cursor: 0, order: ['item-9'] });
        expect((await repository.getRandomSession('playlist-default'))?.order).toEqual(['item-9']);

        await repository.saveRandomSession({ playlistId: 'playlist-empty', seed: 2, cursor: 0, order: [] });
        expect(await repository.next('playlist-empty')).toBeNull();

        await repository.saveRandomSession({ playlistId: 'playlist-out-of-range', seed: 3, cursor: 9, order: ['item-x'] });
        expect(await repository.next('playlist-out-of-range')).toBeNull();
        expect(await repository.next('playlist-missing')).toBeNull();

        const seeded = await repository.createSession('playlist-seeded', ['a', 'b', 'c'], 777);
        expect(seeded.seed).toBe(777);
    });

    it('falls back to default state when IndexedDB read fails', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({ failGet: true }),
            configurable: true,
            writable: true,
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });

        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });
        const result = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            limit: 10,
            offset: 0,
        });

        expect(result.rows).toEqual([]);
        expect(result.totalMatchCount).toBe(0);
        expect(warn).toHaveBeenCalledWith(
            'Failed to load playlist repository state from IndexedDB',
            expect.objectContaining({ error: expect.any(Error) }),
        );
    });

    it('propagates IndexedDB open failures', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({ failOpen: true }),
            configurable: true,
            writable: true,
        });

        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });
        await expect(repository.queryPlaylist({
            playlistId: 'playlist-default',
            limit: 10,
            offset: 0,
        })).rejects.toThrow('fake open failure');
    });

    it('falls back to default state for incompatible persisted schema version', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({
                initialPersistedState: {
                    version: 999,
                    tracks: { stale: {} },
                },
            }),
            configurable: true,
            writable: true,
        });

        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });
        const rows = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            limit: 10,
            offset: 0,
        });

        expect(rows.totalMatchCount).toBe(0);
        expect(await repository.getSession('playlist-default')).toBeNull();
        expect(await repository.getPlaylistItems('playlist-default')).toEqual([]);
    });

    it('propagates write failures from IndexedDB', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({ failPut: true }),
            configurable: true,
            writable: true,
        });

        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });

        await expect(repository.upsertTracks([buildTrack()])).rejects.toThrow('fake put failure');
    });

    it('normalizes partial persisted state fields to defaults', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({
                initialPersistedState: {
                    version: 1,
                    tracks: null,
                    playlistItemsByPlaylistId: null,
                    sessionsByPlaylistId: null,
                    randomSessionsByPlaylistId: null,
                },
            }),
            configurable: true,
            writable: true,
        });

        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });

        expect(await repository.getPlaylistItems('playlist-default')).toEqual([]);
        expect(await repository.getSession('playlist-default')).toBeNull();
        expect(await repository.getRandomSession('playlist-default')).toBeNull();
        const tracks = await repository.getTracksByIds(['missing']);
        expect(tracks.size).toBe(0);
    });

    it('excludes tracks without matching category when category filter is provided', async () => {
        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });

        const uncategorizedTrack: TrackRecord = {
            ...buildTrack({ trackId: 'track-uncategorized', title: 'No Category', path: '/uncat.sid', sourceLocator: '/uncat.sid' }),
            category: null,
        };
        await repository.upsertTracks([uncategorizedTrack]);
        await repository.replacePlaylistItems('playlist-default', [
            buildItem('item-uncategorized', 'track-uncategorized', '0001'),
        ]);

        const result = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            categoryFilter: ['song'],
            limit: 10,
            offset: 0,
        });

        expect(result.totalMatchCount).toBe(0);
        expect(result.rows).toEqual([]);
    });

    it('persists and retrieves playlist sessions and default-sorted playlist items', async () => {
        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });

        await repository.upsertTracks([
            buildTrack({ trackId: 'track-2', title: 'Two', path: '/b.sid', sourceLocator: '/b.sid' }),
            buildTrack({ trackId: 'track-1', title: 'One', path: '/a.sid', sourceLocator: '/a.sid' }),
        ]);

        await repository.replacePlaylistItems('playlist-default', [
            buildItem('item-2', 'track-2', '0002'),
            buildItem('item-1', 'track-1', '0001'),
        ]);

        const items = await repository.getPlaylistItems('playlist-default');
        expect(items.map((item) => item.playlistItemId)).toEqual(['item-1', 'item-2']);

        await repository.saveSession({
            playlistId: 'playlist-default',
            currentPlaylistItemId: 'item-1',
            isPlaying: true,
            isPaused: false,
            elapsedMs: 10,
            playedMs: 20,
            shuffleEnabled: false,
            repeatEnabled: false,
            randomSeed: null,
            randomCursor: null,
            activeQuery: '',
            updatedAt: '2026-02-12T00:00:00.000Z',
        });

        const session = await repository.getSession('playlist-default');
        expect(session?.currentPlaylistItemId).toBe('item-1');

        const paged = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            offset: -3,
            limit: 0,
        });
        expect(paged.rows).toHaveLength(1);
        expect(paged.rows[0]?.playlistItem.playlistItemId).toBe('item-1');
    });

    it('skips durability request when storage persist API is unavailable', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: {},
            configurable: true,
            writable: true,
        });

        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: true });
        const result = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            limit: 10,
            offset: 0,
        });
        expect(result.totalMatchCount).toBe(0);
    });

    it('supports repository bootstrap when IndexedDB store already exists', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({ preExistingStore: true }),
            configurable: true,
            writable: true,
        });

        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });
        const result = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            limit: 10,
            offset: 0,
        });
        expect(result.totalMatchCount).toBe(0);
    });

    it('uses fallback IndexedDB error messages when request.error is missing', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({ failGet: true, failGetWithoutError: true }),
            configurable: true,
            writable: true,
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });

        const result = await repository.queryPlaylist({
            playlistId: 'playlist-default',
            limit: 10,
            offset: 0,
        });
        expect(result.totalMatchCount).toBe(0);
        expect(warn).toHaveBeenCalled();

        resetIndexedDbPlaylistRepositoryForTests();
        Object.defineProperty(globalThis, 'indexedDB', {
            value: createFakeIndexedDb({ failPut: true, failPutWithoutError: true }),
            configurable: true,
            writable: true,
        });
        const failingWriteRepository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });
        await expect(failingWriteRepository.upsertTracks([buildTrack()])).rejects.toThrow('IndexedDB write failed');
    });
});
