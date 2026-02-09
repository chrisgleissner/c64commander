/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hvsc/hvscService', () => ({
    getHvscFolderListing: vi.fn(),
    getHvscSong: vi.fn(),
}));

vi.mock('@/lib/hvsc/hvscSongLengthService', () => ({
    resolveHvscSonglengthDuration: vi.fn(),
}));

vi.mock('@/lib/sid/sidUtils', () => ({
    base64ToUint8: vi.fn((str: string) => new Uint8Array([1, 2, 3])),
}));

import { getHvscFolderListing, getHvscSong } from '@/lib/hvsc/hvscService';
import { resolveHvscSonglengthDuration } from '@/lib/hvsc/hvscSongLengthService';
import { HvscSongSource } from '@/lib/hvsc/hvscSource';

describe('HvscSongSource', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('has id "hvsc"', () => {
        expect(HvscSongSource.id).toBe('hvsc');
    });

    describe('listFolders', () => {
        it('maps HVSC folder listing to SongFolder array', async () => {
            vi.mocked(getHvscFolderListing).mockResolvedValue({
                path: '/',
                folders: ['/DEMOS', '/MUSICIANS'],
                songs: [],
            });

            const folders = await HvscSongSource.listFolders('/');
            expect(folders).toEqual([
                { path: '/DEMOS', name: 'DEMOS' },
                { path: '/MUSICIANS', name: 'MUSICIANS' },
            ]);
        });
    });

    describe('listSongs', () => {
        it('maps a single-subsong SID without expansion', async () => {
            vi.mocked(getHvscFolderListing).mockResolvedValue({
                path: '/DEMOS/0-9',
                folders: [],
                songs: [{
                    id: 1001,
                    virtualPath: '/DEMOS/0-9/35_Years.sid',
                    fileName: '35_Years.sid',
                    durationSeconds: 161,
                    durationsSeconds: null,
                    subsongCount: null,
                }],
            });
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({
                durationSeconds: 161,
                durations: null,
                subsongCount: null,
            });

            const songs = await HvscSongSource.listSongs('/DEMOS/0-9');
            expect(songs).toHaveLength(1);
            expect(songs[0]).toMatchObject({
                id: '1001',
                path: '/DEMOS/0-9/35_Years.sid',
                title: '35_Years.sid',
                durationMs: 161000,
                songNr: 1,
                subsongCount: 1,
                source: 'hvsc',
            });
        });

        it('expands multi-subsong SID into separate entries', async () => {
            vi.mocked(getHvscFolderListing).mockResolvedValue({
                path: '/DEMOS',
                folders: [],
                songs: [{
                    id: 2002,
                    virtualPath: '/DEMOS/MultisongDemo.sid',
                    fileName: 'MultisongDemo.sid',
                    durationSeconds: 30,
                    durationsSeconds: null,
                    subsongCount: null,
                }],
            });
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({
                durationSeconds: 30,
                durations: [30, 45, 60],
                subsongCount: 3,
            });

            const songs = await HvscSongSource.listSongs('/DEMOS');
            expect(songs).toHaveLength(3);
            expect(songs[0].title).toBe('MultisongDemo.sid (Song 1/3)');
            expect(songs[0].durationMs).toBe(30000);
            expect(songs[0].id).toBe('2002:1');
            expect(songs[1].title).toBe('MultisongDemo.sid (Song 2/3)');
            expect(songs[1].durationMs).toBe(45000);
            expect(songs[1].id).toBe('2002:2');
            expect(songs[2].title).toBe('MultisongDemo.sid (Song 3/3)');
            expect(songs[2].durationMs).toBe(60000);
            expect(songs[2].id).toBe('2002:3');
        });

        it('skips resolution when song already has durationsSeconds', async () => {
            vi.mocked(getHvscFolderListing).mockResolvedValue({
                path: '/DEMOS',
                folders: [],
                songs: [{
                    id: 3003,
                    virtualPath: '/DEMOS/Cached.sid',
                    fileName: 'Cached.sid',
                    durationSeconds: 77,
                    durationsSeconds: [77],
                    subsongCount: 1,
                }],
            });

            const songs = await HvscSongSource.listSongs('/DEMOS');
            expect(resolveHvscSonglengthDuration).not.toHaveBeenCalled();
            expect(songs).toHaveLength(1);
            expect(songs[0].durationMs).toBe(77000);
        });

        it('handles null duration from resolution', async () => {
            vi.mocked(getHvscFolderListing).mockResolvedValue({
                path: '/DEMOS',
                folders: [],
                songs: [{
                    id: 4004,
                    virtualPath: '/DEMOS/Unknown.sid',
                    fileName: 'Unknown.sid',
                    durationSeconds: null,
                    durationsSeconds: null,
                    subsongCount: null,
                }],
            });
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({
                durationSeconds: null,
                durations: null,
                subsongCount: null,
            });

            const songs = await HvscSongSource.listSongs('/DEMOS');
            expect(songs).toHaveLength(1);
            expect(songs[0].durationMs).toBeUndefined();
        });
    });

    describe('getSong', () => {
        it('decodes base64 data and returns song info', async () => {
            vi.mocked(getHvscSong).mockResolvedValue({
                id: 5005,
                virtualPath: '/DEMOS/0-9/35_Years.sid',
                fileName: '35_Years.sid',
                durationSeconds: 161,
                durationsSeconds: null,
                subsongCount: null,
                md5: null,
                dataBase64: 'AQID',
            });

            const entry = {
                id: '5005',
                path: '/DEMOS/0-9/35_Years.sid',
                title: '35_Years.sid',
                durationMs: 161000,
                songNr: 1,
                subsongCount: 1,
                source: 'hvsc',
                payload: { id: 5005, virtualPath: '/DEMOS/0-9/35_Years.sid' },
            };

            const result = await HvscSongSource.getSong(entry);
            expect(result.data).toBeInstanceOf(Uint8Array);
            expect(result.title).toBe('35_Years.sid');
            expect(result.path).toBe('/DEMOS/0-9/35_Years.sid');
            expect(result.durationMs).toBe(161000);
        });
    });
});
