/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
        isPluginAvailable: vi.fn(() => false),
    },
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: { Data: 'DATA' },
    Filesystem: {
        stat: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
        downloadFile: vi.fn(),
    },
}));

vi.mock('@/lib/hvsc/hvscFilesystem', () => ({
    getHvscCacheDir: vi.fn(() => 'hvsc/cache'),
    writeCachedArchive: vi.fn(async () => undefined),
    deleteCachedArchive: vi.fn(async () => undefined),
    writeCachedArchiveMarker: vi.fn(async () => undefined),
    readCachedArchiveMarker: vi.fn(async () => null),
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

vi.mock('@/lib/sid/sidUtils', () => ({
    base64ToUint8: vi.fn((str: string) => new TextEncoder().encode(atob(str))),
}));

import {
    getErrorMessage,
    isExistsError,
    normalizeEntryName,
    normalizeVirtualPath,
    normalizeLibraryPath,
    normalizeUpdateVirtualPath,
    normalizeUpdateLibraryPath,
    isDeletionList,
    parseDeletionList,
    concatChunks,
    parseContentLength,
    fetchContentLength,
    emitDownloadProgress,
    ensureNotCancelledWith,
    downloadArchive,
} from '@/lib/hvsc/hvscDownload';

import { addLog } from '@/lib/logging';

describe('hvscDownload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('logs when content length fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

        const length = await fetchContentLength('http://example.com/archive.7z');

        expect(length).toBeNull();
        expect(vi.mocked(addLog)).toHaveBeenCalledWith(
            'warn',
            'Failed to read HVSC content length',
            expect.objectContaining({
                url: 'http://example.com/archive.7z',
            }),
        );
    });

    // ── getErrorMessage ──

    describe('getErrorMessage', () => {
        it('extracts string errors', () => {
            expect(getErrorMessage('boom')).toBe('boom');
        });

        it('extracts message from Error objects', () => {
            expect(getErrorMessage(new Error('fail'))).toBe('fail');
        });

        it('extracts nested error.error.message', () => {
            expect(getErrorMessage({ error: { message: 'nested' } })).toBe('nested');
        });

        it('extracts error.error as string', () => {
            expect(getErrorMessage({ error: 'flat-nested' })).toBe('flat-nested');
        });

        it('stringifies null/undefined', () => {
            expect(getErrorMessage(null)).toBe('');
            expect(getErrorMessage(undefined)).toBe('');
        });

        it('stringifies number errors', () => {
            expect(getErrorMessage(42)).toBe('42');
        });
    });

    // ── isExistsError ──

    describe('isExistsError', () => {
        it('detects "already exists" errors', () => {
            expect(isExistsError(new Error('File already exists'))).toBe(true);
        });

        it('detects "exists" errors', () => {
            expect(isExistsError('Path exists')).toBe(true);
        });

        it('rejects unrelated errors', () => {
            expect(isExistsError(new Error('permission denied'))).toBe(false);
        });
    });

    // ── normalizeEntryName ──

    describe('normalizeEntryName', () => {
        it('replaces backslashes with forward slashes', () => {
            expect(normalizeEntryName('HVSC\\DEMOS\\test.sid')).toBe('HVSC/DEMOS/test.sid');
        });

        it('strips leading slashes', () => {
            expect(normalizeEntryName('///HVSC/test.sid')).toBe('HVSC/test.sid');
        });
    });

    // ── normalizeVirtualPath ──

    describe('normalizeVirtualPath', () => {
        it('strips HVSC/ prefix and adds leading slash for .sid', () => {
            expect(normalizeVirtualPath('HVSC/DEMOS/test.sid')).toBe('/DEMOS/test.sid');
        });

        it('strips C64Music/ prefix', () => {
            expect(normalizeVirtualPath('C64Music/MUSICIANS/Rob_Hubbard/Commando.sid')).toBe(
                '/MUSICIANS/Rob_Hubbard/Commando.sid',
            );
        });

        it('returns null for non-.sid entries', () => {
            expect(normalizeVirtualPath('HVSC/DOCUMENTS/readme.txt')).toBeNull();
        });

        it('handles backslashes', () => {
            expect(normalizeVirtualPath('HVSC\\DEMOS\\test.sid')).toBe('/DEMOS/test.sid');
        });
    });

    // ── normalizeLibraryPath ──

    describe('normalizeLibraryPath', () => {
        it('normalizes HVSC library path for .sid files', () => {
            expect(normalizeLibraryPath('HVSC/DEMOS/test.sid')).toBe('/DEMOS/test.sid');
        });

        it('normalizes non-.sid entries too', () => {
            expect(normalizeLibraryPath('HVSC/DOCUMENTS/Songlengths.md5')).toBe('/DOCUMENTS/Songlengths.md5');
        });

        it('returns null for empty path after stripping', () => {
            expect(normalizeLibraryPath('HVSC/')).toBeNull();
        });
    });

    // ── normalizeUpdateVirtualPath ──

    describe('normalizeUpdateVirtualPath', () => {
        it('strips new/ prefix from update entries', () => {
            expect(normalizeUpdateVirtualPath('new/DEMOS/test.sid')).toBe('/DEMOS/test.sid');
        });

        it('strips update/ prefix', () => {
            expect(normalizeUpdateVirtualPath('update/MUSICIANS/test.sid')).toBe('/MUSICIANS/test.sid');
        });

        it('strips updated/ prefix', () => {
            expect(normalizeUpdateVirtualPath('updated/DEMOS/test.sid')).toBe('/DEMOS/test.sid');
        });

        it('strips HVSC/ then new/ prefix', () => {
            expect(normalizeUpdateVirtualPath('HVSC/new/DEMOS/test.sid')).toBe('/DEMOS/test.sid');
        });

        it('returns null for non-.sid', () => {
            expect(normalizeUpdateVirtualPath('new/DOCUMENTS/readme.txt')).toBeNull();
        });
    });

    // ── normalizeUpdateLibraryPath ──

    describe('normalizeUpdateLibraryPath', () => {
        it('strips new/ prefix for library paths', () => {
            expect(normalizeUpdateLibraryPath('new/DOCUMENTS/Songlengths.md5')).toBe('/DOCUMENTS/Songlengths.md5');
        });

        it('strips update/ prefix for library paths', () => {
            expect(normalizeUpdateLibraryPath('update/DOCUMENTS/Songlengths.md5')).toBe('/DOCUMENTS/Songlengths.md5');
        });
    });

    // ── isDeletionList ──

    describe('isDeletionList', () => {
        it('detects deletion list files', () => {
            expect(isDeletionList('delete_files.txt')).toBe(true);
            expect(isDeletionList('REMOVE_LIST.txt')).toBe(true);
        });

        it('rejects non-deletion files', () => {
            expect(isDeletionList('songlengths.md5')).toBe(false);
            expect(isDeletionList('readme.txt')).toBe(false);
        });

        it('rejects non-.txt extension', () => {
            expect(isDeletionList('deleted_songs.sid')).toBe(false);
        });
    });

    // ── parseDeletionList ──

    describe('parseDeletionList', () => {
        it('parses newline-separated .sid paths', () => {
            const input = 'DEMOS/foo.sid\nMUSICIANS/bar.sid\n';
            expect(parseDeletionList(input)).toEqual(['/DEMOS/foo.sid', '/MUSICIANS/bar.sid']);
        });

        it('adds leading slash if missing', () => {
            expect(parseDeletionList('test.sid')).toEqual(['/test.sid']);
        });

        it('preserves existing leading slash', () => {
            expect(parseDeletionList('/test.sid')).toEqual(['/test.sid']);
        });

        it('filters out non-.sid lines', () => {
            expect(parseDeletionList('readme.txt\ntest.sid')).toEqual(['/test.sid']);
        });

        it('handles CRLF', () => {
            expect(parseDeletionList('a.sid\r\nb.sid')).toEqual(['/a.sid', '/b.sid']);
        });

        it('ignores blank lines', () => {
            expect(parseDeletionList('\n\ntest.sid\n\n')).toEqual(['/test.sid']);
        });
    });

    // ── concatChunks ──

    describe('concatChunks', () => {
        it('concatenates chunks into single buffer', () => {
            const a = new Uint8Array([1, 2]);
            const b = new Uint8Array([3, 4, 5]);
            const result = concatChunks([a, b]);
            expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
            expect(result.length).toBe(5);
        });

        it('uses totalLength when provided', () => {
            const a = new Uint8Array([1, 2]);
            const result = concatChunks([a], 5);
            expect(result.length).toBe(5);
            expect(result[0]).toBe(1);
            expect(result[1]).toBe(2);
        });

        it('handles empty array', () => {
            expect(concatChunks([])).toEqual(new Uint8Array([]));
        });
    });

    // ── parseContentLength ──

    describe('parseContentLength', () => {
        it('parses valid content-length', () => {
            expect(parseContentLength('12345')).toBe(12345);
        });

        it('returns null for null input', () => {
            expect(parseContentLength(null)).toBeNull();
        });

        it('returns null for non-finite values', () => {
            expect(parseContentLength('NaN')).toBeNull();
            expect(parseContentLength('Infinity')).toBeNull();
        });

        it('returns null for zero or negative', () => {
            expect(parseContentLength('0')).toBeNull();
            expect(parseContentLength('-1')).toBeNull();
        });
    });

    // ── emitDownloadProgress ──

    describe('emitDownloadProgress', () => {
        it('emits download progress with percent', () => {
            const emitProgress = vi.fn();
            emitDownloadProgress(emitProgress, 'test.7z', 50, 100);
            expect(emitProgress).toHaveBeenCalledWith({
                stage: 'download',
                message: 'Downloading test.7z…',
                archiveName: 'test.7z',
                downloadedBytes: 50,
                totalBytes: 100,
                percent: 50,
            });
        });

        it('emits without percent when totalBytes is null', () => {
            const emitProgress = vi.fn();
            emitDownloadProgress(emitProgress, 'test.7z', 50, null);
            expect(emitProgress).toHaveBeenCalledWith({
                stage: 'download',
                message: 'Downloading test.7z…',
                archiveName: 'test.7z',
                downloadedBytes: 50,
                totalBytes: undefined,
                percent: undefined,
            });
        });
    });

    // ── ensureNotCancelledWith ──

    describe('ensureNotCancelledWith', () => {
        it('does nothing when token is not cancelled', () => {
            const tokens = new Map([['t1', { cancelled: false }]]);
            expect(() => ensureNotCancelledWith(tokens, 't1')).not.toThrow();
        });

        it('throws when token is cancelled', () => {
            const tokens = new Map([['t1', { cancelled: true }]]);
            expect(() => ensureNotCancelledWith(tokens, 't1')).toThrow('HVSC update cancelled');
        });

        it('calls stateUpdater when token is cancelled', () => {
            const tokens = new Map([['t1', { cancelled: true }]]);
            const updater = vi.fn();
            expect(() => ensureNotCancelledWith(tokens, 't1', updater)).toThrow();
            expect(updater).toHaveBeenCalledWith({
                ingestionState: 'idle',
                ingestionError: 'Cancelled',
            });
        });

        it('does nothing when token is undefined', () => {
            const tokens = new Map<string, { cancelled: boolean }>();
            expect(() => ensureNotCancelledWith(tokens, undefined)).not.toThrow();
        });
    });

    // ── downloadArchive ──

    describe('downloadArchive', () => {
        const makeOptions = (overrides: Partial<Parameters<typeof downloadArchive>[0]> = {}) => ({
            plan: { type: 'baseline' as const, version: 84 },
            archiveName: 'hvsc-baseline-84.7z',
            archivePath: 'hvsc-baseline-84.7z',
            downloadUrl: 'https://example.com/hvsc.7z',
            cancelToken: 'token-1',
            cancelTokens: new Map([['token-1', { cancelled: false }]]),
            emitProgress: vi.fn(),
            ...overrides,
        });

        beforeEach(() => {
            vi.clearAllMocks();
            globalThis.fetch = vi.fn();
        });

        it('streams download progress and writes archive', async () => {
            const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6])];
            let index = 0;
            (globalThis.fetch as any).mockResolvedValue({
                ok: true,
                headers: { get: () => '6' },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (index >= chunks.length) return { done: true, value: undefined };
                            const value = chunks[index];
                            index += 1;
                            return { done: false, value };
                        },
                    }),
                },
            });

            const options = makeOptions();
            await downloadArchive(options);

            const { writeCachedArchive } = await import('@/lib/hvsc/hvscFilesystem');
            expect(writeCachedArchive).toHaveBeenCalledWith('hvsc-baseline-84.7z', expect.any(Uint8Array));
            const progressStages = (options.emitProgress as any).mock.calls.map((call: any[]) => call[0]?.stage);
            expect(progressStages).toContain('download');
        });

        it('throws on content-length mismatch (streaming)', async () => {
            let readCalls = 0;
            (globalThis.fetch as any).mockResolvedValue({
                ok: true,
                headers: { get: () => '5' },
                body: {
                    getReader: () => ({
                        read: async () => {
                            readCalls += 1;
                            if (readCalls === 1) return { done: false, value: new Uint8Array([1, 2]) };
                            return { done: true, value: undefined };
                        },
                    }),
                },
            });

            await expect(downloadArchive(makeOptions())).rejects.toThrow('Download size mismatch');
        });

        it('throws on content-length mismatch (buffered)', async () => {
            (globalThis.fetch as any).mockResolvedValue({
                ok: true,
                headers: { get: () => '4' },
                body: null,
                arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
            });

            await expect(downloadArchive(makeOptions())).rejects.toThrow('Download size mismatch');
        });

        it('cancels mid-download when token flips', async () => {
            const tokens = new Map([['token-1', { cancelled: false }]]);
            let index = 0;
            (globalThis.fetch as any).mockResolvedValue({
                ok: true,
                headers: { get: () => '4' },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (index === 0) {
                                index += 1;
                                return { done: false, value: new Uint8Array([1, 2]) };
                            }
                            tokens.get('token-1')!.cancelled = true;
                            return { done: false, value: new Uint8Array([3, 4]) };
                        },
                    }),
                },
            });

            await expect(downloadArchive(makeOptions({ cancelTokens: tokens }))).rejects.toThrow('HVSC update cancelled');
        });

        it('propagates HTTP errors', async () => {
            (globalThis.fetch as any).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Server error',
                headers: { get: () => null },
            });

            await expect(downloadArchive(makeOptions())).rejects.toThrow('Download failed: 500 Server error');
        });
    });
});
