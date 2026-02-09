/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */


import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as hvscFS from '@/lib/hvsc/hvscFilesystem';
import { Filesystem } from '@capacitor/filesystem';
import { resolveHvscSonglengthDuration } from '@/lib/hvsc/hvscSongLengthService';
import * as sidUtils from '@/lib/sid/sidUtils';

// Mocks
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        stat: vi.fn(),
        writeFile: vi.fn(),
        readFile: vi.fn(),
        readdir: vi.fn(),
        deleteFile: vi.fn(),
        mkdir: vi.fn(),
        rmdir: vi.fn(),
    },
    Directory: { Data: 'DATA' },
}));

vi.mock('@/lib/hvsc/hvscSongLengthService', () => ({
    ensureHvscSonglengthsReadyOnColdStart: vi.fn(async () => undefined),
    resolveHvscSonglengthDuration: vi.fn(async () => ({ durationSeconds: null })),
    resetHvscSonglengths: vi.fn(),
}));

vi.mock('@/lib/sid/sidUtils', async (importOriginal) => {
    const actual = await importOriginal<typeof sidUtils>();
    return {
        ...actual,
        base64ToUint8: vi.fn((str) => {
            try {
                const bin = atob(str);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                return arr;
            } catch (e) {
                return new Uint8Array([]);
            }
        }),
    };
});

describe('hvscFilesystem error handling', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(Filesystem.writeFile).mockReset();
        vi.mocked(Filesystem.stat).mockReset();
    });

    describe('writeFileWithRetry', () => {
        it('retries write if file exists error occurs and file is not actually there', async () => {
            // 1. First write fails with "exists"
            vi.mocked(Filesystem.writeFile)
                .mockRejectedValueOnce({ message: 'File already exists' })
                // 2. Second write succeeds
                .mockResolvedValueOnce({ uri: 'ok' });

            // Stat returns null (file doesn't exist)
            vi.mocked(Filesystem.stat).mockResolvedValue(null as any);

            await hvscFS.writeLibraryFile('/foo/bar.sid', new Uint8Array([1, 2, 3]));

            expect(Filesystem.writeFile).toHaveBeenCalledTimes(2);
            expect(Filesystem.rmdir).toHaveBeenCalled();
            expect(Filesystem.deleteFile).toHaveBeenCalled();
        });

        it('does not retry if file already exists as a file (valid state)', async () => {
            vi.mocked(Filesystem.writeFile).mockRejectedValueOnce({ message: 'File already exists' });
            vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'file' } as any);

            await hvscFS.writeLibraryFile('/foo/bar.sid', new Uint8Array([1]));

            expect(Filesystem.writeFile).toHaveBeenCalledTimes(1);
        });

        it('throws after retry fails even if exists error persists (but not a file)', async () => {
            vi.mocked(Filesystem.stat).mockResolvedValue(null as any);

            // 1. First write fails (exists)
            // 2. Retry write fails (exists)
            vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error('File already exists'));

            await expect(hvscFS.writeLibraryFile('/foo.sid', new Uint8Array([]))).rejects.toThrow('File already exists');

            expect(Filesystem.writeFile).toHaveBeenCalledTimes(2);
        });

        it('throws non-exists errors immediately', async () => {
            vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error('Disk full'));
            await expect(hvscFS.writeLibraryFile('/f.sid', new Uint8Array([]))).rejects.toThrow('Disk full');
        });
    });

    describe('ensureDir', () => {
        it('deletes conflicting file if directory creation fails', async () => {
            vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'file' } as any);
            // We need mocking deleteFile rejection? No, default success.
            // But wait, ensureDir calls stat.
            // First check: existing=file.
            // Then deleteFile.
            // Then mkdir.
            await hvscFS.ensureHvscDirs();

            expect(Filesystem.deleteFile).toHaveBeenCalled();
            expect(Filesystem.mkdir).toHaveBeenCalled();
        });

        it('handles mkdir exists error gracefully', async () => {
            vi.mocked(Filesystem.stat).mockResolvedValue(null as any);
            vi.mocked(Filesystem.mkdir).mockRejectedValue({ message: 'Directory exists' });

            await expect(hvscFS.ensureHvscDirs()).resolves.toBeUndefined();
        });

        it('rethrows non-exists errors from mkdir', async () => {
            vi.mocked(Filesystem.stat).mockResolvedValue(null as any);
            vi.mocked(Filesystem.mkdir).mockRejectedValue({ message: 'Disk failure' });
            await expect(hvscFS.ensureHvscDirs()).rejects.toThrow('Disk failure');
        });

        it('extracts nested error messages correctly', async () => {
            vi.mocked(Filesystem.stat).mockResolvedValue(null as any);
            vi.mocked(Filesystem.mkdir).mockRejectedValue({ error: { message: 'Deep failure' } });
            await expect(hvscFS.ensureHvscDirs()).rejects.toEqual({ error: { message: 'Deep failure' } });

            vi.mocked(Filesystem.mkdir).mockRejectedValue({ error: 'Simple error' });
            await expect(hvscFS.ensureHvscDirs()).rejects.toEqual({ error: 'Simple error' });

            vi.mocked(Filesystem.mkdir).mockRejectedValue('String error');
            await expect(hvscFS.ensureHvscDirs()).rejects.toBe('String error');

            vi.mocked(Filesystem.mkdir).mockRejectedValue({ message: 'Direct message' });
            await expect(hvscFS.ensureHvscDirs()).rejects.toEqual({ message: 'Direct message' });

            const weirdError = { unknown: true };
            vi.mocked(Filesystem.mkdir).mockRejectedValue(weirdError);
            await expect(hvscFS.ensureHvscDirs()).rejects.toBe(weirdError);
        });

        it('ensureDir returns early if directory already exists', async () => {
            vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'directory' } as any);
            await hvscFS.ensureHvscDirs();
            expect(Filesystem.mkdir).not.toHaveBeenCalled();
        });
    });

    describe('helper util coverage', () => {
        it('readCachedArchiveMarker handles invalid JSON', async () => {
            vi.mocked(Filesystem.readFile).mockResolvedValue({ data: btoa('{invalid') } as any);
            const marker = await hvscFS.readCachedArchiveMarker('foo');
            expect(marker).toBeNull();
        });

        it('readCachedArchiveMarker handles missing completedAt', async () => {
            vi.mocked(Filesystem.readFile).mockResolvedValue({ data: btoa('{}') } as any);
            const marker = await hvscFS.readCachedArchiveMarker('foo');
            expect(marker).toBeNull();
        });

        it('listHvscFolder handles non-root path', async () => {
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] });
            const result = await hvscFS.listHvscFolder('/DEMOS');
            expect(result.path).toBe('/DEMOS');
        });

        it('listHvscFolder handles empty path', async () => {
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] });
            await hvscFS.listHvscFolder('');
            expect(Filesystem.readdir).toHaveBeenCalled();
        });

        it('getHvscDurationByMd5 returns duration', async () => {
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValue({ durationSeconds: 123, strategy: 'md5' } as any);
            const duration = await hvscFS.getHvscDurationByMd5('abc');
            expect(duration).toBe(123);
        });

        it('getHvscSongByVirtualPath handles missing file', async () => {
            vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('File not found'));
            const result = await hvscFS.getHvscSongByVirtualPath('/missing.sid');
            expect(result).toBeNull();
        });

        it('listHvscFolder handles string entries (legacy/fallback)', async () => {
            vi.mocked(Filesystem.readdir).mockResolvedValue({
                files: ['string-file.sid'] as any
            });
            vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'file' } as any);

            const result = await hvscFS.listHvscFolder('/');
            expect(result.songs).toHaveLength(1);
            expect(result.songs[0].fileName).toBe('string-file.sid');

            expect(Filesystem.stat).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('string-file.sid') }));
        });

        it('decodeBase64Text returns raw string on failure', async () => {
            vi.mocked(sidUtils.base64ToUint8).mockImplementationOnce(() => { throw new Error('Bad base64'); });

            vi.mocked(Filesystem.readFile).mockResolvedValue({ data: 'not-base64' } as any);
            const marker = await hvscFS.readCachedArchiveMarker('foo');
            expect(marker).toBeNull();
        });

        it('getHvscSongByVirtualPath handles durations logic', async () => {
            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValueOnce({ durations: [10, 20], durationSeconds: 10 } as any);
            vi.mocked(Filesystem.readFile).mockResolvedValue({ data: '' } as any);
            const s1 = await hvscFS.getHvscSongByVirtualPath('/1.sid');
            expect(s1?.subsongCount).toBe(2);

            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValueOnce({ durations: [], durationSeconds: 50 } as any);
            const s2 = await hvscFS.getHvscSongByVirtualPath('/2.sid');
            expect(s2?.subsongCount).toBe(1);

            vi.mocked(resolveHvscSonglengthDuration).mockResolvedValueOnce({ durations: [], durationSeconds: null } as any);
            const s3 = await hvscFS.getHvscSongByVirtualPath('/3.sid');
            expect(s3?.subsongCount).toBeNull();
        });
    });

    describe('Listing and Resolution', () => {
        it('listHvscFolder returns empty lists if filesystem access fails', async () => {
            vi.mocked(Filesystem.readdir).mockRejectedValue(new Error('Access denied'));
            const result = await hvscFS.listHvscFolder('/test');
            expect(result.folders).toEqual([]);
            expect(result.songs).toEqual([]);
        });

        it('resolveEntry fetches stats for entries missing type info', async () => {
            vi.mocked(Filesystem.readdir).mockResolvedValue({
                files: [{ name: 'mystery-file' }] as any
            });
            vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'file' } as any);

            await hvscFS.listHvscFolder('/');
            expect(Filesystem.stat).toHaveBeenCalledWith(expect.objectContaining({
                path: expect.stringContaining('mystery-file')
            }));
        });

        it('resolveEntry handles mixed entry types correctly', async () => {
            vi.mocked(Filesystem.readdir).mockResolvedValue({
                files: [
                    { name: 'known-dir', type: 'directory' },
                    { name: 'unknown-thing' } as any
                ]
            });

            vi.mocked(Filesystem.stat).mockImplementation(async (opts) => {
                if (opts.path && opts.path.endsWith('unknown-thing')) {
                    return { type: 'directory' } as any;
                }
                return { type: 'file' } as any;
            });

            const result = await hvscFS.listHvscFolder('/');
            expect(result.folders).toContain('/known-dir');
            expect(result.folders).toContain('/unknown-thing');
        });

        it('filters out non-sid files', async () => {
            vi.mocked(Filesystem.readdir).mockResolvedValue({
                files: [
                    { name: 'readme.txt', type: 'file' },
                    { name: 'image.png', type: 'file' },
                    { name: 'song.sid', type: 'file' }
                ]
            });

            const result = await hvscFS.listHvscFolder('/foo');
            expect(result.songs).toHaveLength(1);
            expect(result.songs[0].fileName).toBe('song.sid');
        });

        it('ignores entries with no name', async () => {
            vi.mocked(Filesystem.readdir).mockResolvedValue({
                files: [{ type: 'file' }] as any
            });
            const result = await hvscFS.listHvscFolder('/');
            expect(result.songs).toHaveLength(0);
        });
    });

    describe('Ignored Errors coverage', () => {
        it('ignores deleteFile errors during write retry', async () => {
            vi.mocked(Filesystem.writeFile).mockRejectedValueOnce({ message: 'File already exists' });
            vi.mocked(Filesystem.stat).mockResolvedValue(null as any);
            vi.mocked(Filesystem.deleteFile).mockRejectedValue(new Error('Delete error'));
            vi.mocked(Filesystem.writeFile).mockResolvedValueOnce({ uri: 'ok' });

            await hvscFS.writeLibraryFile('/foo', new Uint8Array([1]));
            expect(Filesystem.deleteFile).toHaveBeenCalled();
        });

        it('ignores deleteFile errors when clearing conflicting file for directory', async () => {
            vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'file' } as any);
            vi.mocked(Filesystem.deleteFile).mockRejectedValue(new Error('Locked'));
            vi.mocked(Filesystem.mkdir).mockResolvedValue({} as any);

            await hvscFS.ensureHvscDirs();
            expect(Filesystem.deleteFile).toHaveBeenCalled();
        });

        it('ignores rmdir errors when clearing conflicting directory for write', async () => {
            vi.mocked(Filesystem.writeFile).mockRejectedValueOnce({ message: 'File already exists' });
            vi.mocked(Filesystem.stat).mockResolvedValue({ type: 'directory' } as any);
            vi.mocked(Filesystem.rmdir).mockRejectedValue(new Error('NotEmpty'));
            vi.mocked(Filesystem.writeFile).mockResolvedValueOnce({ uri: 'ok' });

            await hvscFS.writeLibraryFile('/foo.sid', new Uint8Array([1]));
            expect(Filesystem.rmdir).toHaveBeenCalled();
        });
    });
});
