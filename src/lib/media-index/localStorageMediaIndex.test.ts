/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonMediaIndex, LocalStorageMediaIndexStorage } from './localStorageMediaIndex';
import type { MediaEntry, MediaIndexStorage } from './mediaIndex';

const STORAGE_KEY = 'c64u_media_index:v1';

describe('LocalStorageMediaIndexStorage', () => {
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

    describe('read', () => {
        it('returns null when localStorage is undefined', async () => {
            Object.defineProperty(global, 'localStorage', {
                value: undefined,
                writable: true,
                configurable: true,
            });

            const storage = new LocalStorageMediaIndexStorage();
            const result = await storage.read();

            expect(result).toBeNull();
        });

        it('returns null when no data in localStorage', async () => {
            localStorageMock.getItem.mockReturnValue(null);

            const storage = new LocalStorageMediaIndexStorage();
            const result = await storage.read();

            expect(result).toBeNull();
        });

        it('returns null when JSON parse fails', async () => {
            localStorageMock.getItem.mockReturnValue('invalid json');

            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const storage = new LocalStorageMediaIndexStorage();
            const result = await storage.read();

            expect(result).toBeNull();
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                'Failed to parse media index snapshot',
                expect.objectContaining({ error: expect.any(SyntaxError) })
            );

            consoleWarnSpy.mockRestore();
        });

        it('returns parsed snapshot when valid JSON', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song.sid', name: 'song.sid', type: 'sid' as const },
                ],
            };
            localStorageMock.getItem.mockReturnValue(JSON.stringify(snapshot));

            const storage = new LocalStorageMediaIndexStorage();
            const result = await storage.read();

            expect(result).toEqual(snapshot);
        });
    });

    describe('write', () => {
        it('does nothing when localStorage is undefined', async () => {
            Object.defineProperty(global, 'localStorage', {
                value: undefined,
                writable: true,
                configurable: true,
            });

            const storage = new LocalStorageMediaIndexStorage();
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [],
            };

            await expect(storage.write(snapshot)).resolves.not.toThrow();
        });

        it('writes snapshot to localStorage', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song.sid', name: 'song.sid', type: 'sid' as const },
                ],
            };

            const storage = new LocalStorageMediaIndexStorage();
            await storage.write(snapshot);

            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                STORAGE_KEY,
                JSON.stringify(snapshot)
            );
        });
    });
});

describe('JsonMediaIndex', () => {
    let storage: MediaIndexStorage;
    let readMock: ReturnType<typeof vi.fn>;
    let writeMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        readMock = vi.fn();
        writeMock = vi.fn();
        storage = {
            read: readMock,
            write: writeMock,
        };
    });

    describe('load', () => {
        it('loads entries from storage', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song.sid', name: 'song.sid', type: 'sid' as const },
                    { path: '/games/game.prg', name: 'game.prg', type: 'prg' as const },
                ],
            };
            readMock.mockResolvedValue(snapshot);

            const index = new JsonMediaIndex(storage);
            await index.load();

            expect(index.getAll()).toHaveLength(2);
            expect(index.queryByPath('/music/song.sid')).toEqual(snapshot.entries[0]);
        });

        it('handles null snapshot', async () => {
            readMock.mockResolvedValue(null);

            const index = new JsonMediaIndex(storage);
            await index.load();

            expect(index.getAll()).toHaveLength(0);
        });

        it('handles snapshot without entries', async () => {
            readMock.mockResolvedValue({
                version: 1,
                updatedAt: '2024-01-01T00:00:00.000Z',
            });

            const index = new JsonMediaIndex(storage);
            await index.load();

            expect(index.getAll()).toHaveLength(0);
        });

        it('clears existing entries on load', async () => {
            const snapshot1 = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song1.sid', name: 'song1.sid', type: 'sid' as const },
                ],
            };
            const snapshot2 = {
                version: 1 as const,
                updatedAt: '2024-01-02T00:00:00.000Z',
                entries: [
                    { path: '/music/song2.sid', name: 'song2.sid', type: 'sid' as const },
                ],
            };

            readMock.mockResolvedValueOnce(snapshot1);

            const index = new JsonMediaIndex(storage);
            await index.load();

            expect(index.getAll()).toHaveLength(1);

            readMock.mockResolvedValueOnce(snapshot2);
            await index.load();

            expect(index.getAll()).toHaveLength(1);
            expect(index.queryByPath('/music/song1.sid')).toBeNull();
            expect(index.queryByPath('/music/song2.sid')).not.toBeNull();
        });
    });

    describe('save', () => {
        it('saves entries to storage', async () => {
            readMock.mockResolvedValue(null);
            writeMock.mockResolvedValue(undefined);

            const index = new JsonMediaIndex(storage);
            await index.load();

            const entries: MediaEntry[] = [
                { path: '/music/song.sid', name: 'song.sid', type: 'sid' },
            ];
            index.setEntries(entries);

            await index.save();

            expect(writeMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    version: 1,
                    entries,
                })
            );
        });
    });

    describe('scan', () => {
        it('loads if not already loaded', async () => {
            readMock.mockResolvedValue(null);

            const index = new JsonMediaIndex(storage);
            await index.scan(['/some/path']);

            expect(readMock).toHaveBeenCalled();
        });

        it('does not reload if already loaded', async () => {
            readMock.mockResolvedValue(null);

            const index = new JsonMediaIndex(storage);
            await index.load();
            readMock.mockClear();

            await index.scan(['/some/path']);

            expect(readMock).not.toHaveBeenCalled();
        });
    });

    describe('queryByType', () => {
        it('filters entries by type', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song1.sid', name: 'song1.sid', type: 'sid' as const },
                    { path: '/games/game.prg', name: 'game.prg', type: 'prg' as const },
                    { path: '/music/song2.sid', name: 'song2.sid', type: 'sid' as const },
                ],
            };
            readMock.mockResolvedValue(snapshot);

            const index = new JsonMediaIndex(storage);
            await index.load();

            const sidEntries = index.queryByType('sid');
            expect(sidEntries).toHaveLength(2);
            expect(sidEntries.every((e) => e.type === 'sid')).toBe(true);

            const prgEntries = index.queryByType('prg');
            expect(prgEntries).toHaveLength(1);

            const diskEntries = index.queryByType('disk');
            expect(diskEntries).toHaveLength(0);
        });
    });

    describe('queryByPath', () => {
        it('returns entry by path', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song.sid', name: 'song.sid', type: 'sid' as const },
                ],
            };
            readMock.mockResolvedValue(snapshot);

            const index = new JsonMediaIndex(storage);
            await index.load();

            expect(index.queryByPath('/music/song.sid')).toEqual(snapshot.entries[0]);
            expect(index.queryByPath('/nonexistent')).toBeNull();
        });
    });

    describe('getAll', () => {
        it('returns all entries', async () => {
            const snapshot = {
                version: 1 as const,
                updatedAt: '2024-01-01T00:00:00.000Z',
                entries: [
                    { path: '/music/song.sid', name: 'song.sid', type: 'sid' as const },
                    { path: '/games/game.prg', name: 'game.prg', type: 'prg' as const },
                ],
            };
            readMock.mockResolvedValue(snapshot);

            const index = new JsonMediaIndex(storage);
            await index.load();

            const all = index.getAll();
            expect(all).toHaveLength(2);
        });

        it('returns empty array when no entries', async () => {
            readMock.mockResolvedValue(null);

            const index = new JsonMediaIndex(storage);
            await index.load();

            expect(index.getAll()).toEqual([]);
        });
    });

    describe('setEntries', () => {
        it('sets entries and clears previous', async () => {
            readMock.mockResolvedValue(null);

            const index = new JsonMediaIndex(storage);
            await index.load();

            const entries1: MediaEntry[] = [
                { path: '/music/song1.sid', name: 'song1.sid', type: 'sid' },
            ];
            index.setEntries(entries1);

            expect(index.getAll()).toHaveLength(1);

            const entries2: MediaEntry[] = [
                { path: '/music/song2.sid', name: 'song2.sid', type: 'sid' },
                { path: '/music/song3.sid', name: 'song3.sid', type: 'sid' },
            ];
            index.setEntries(entries2);

            expect(index.getAll()).toHaveLength(2);
            expect(index.queryByPath('/music/song1.sid')).toBeNull();
        });
    });
});
