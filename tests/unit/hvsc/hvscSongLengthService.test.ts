/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/filesystem', () => ({
    Directory: { Data: 'DATA' },
    Filesystem: {
        mkdir: vi.fn(),
        stat: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
    },
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

vi.mock('@/lib/sid/sidUtils', () => ({
    base64ToUint8: vi.fn((str: string) => new TextEncoder().encode(atob(str))),
}));

const mockFacade = vi.hoisted(() => ({
    loadOnColdStart: vi.fn(async () => undefined),
    reloadOnConfigChange: vi.fn(async () => undefined),
    resolveDurationSeconds: vi.fn(() => ({ durationSeconds: 42, durations: null, subsongCount: null })),
    stats: vi.fn(() => ({ entries: 10, sources: 1 })),
    reset: vi.fn(),
}));

vi.mock('@/lib/songlengths', () => ({
    InMemoryTextBackend: vi.fn(() => ({})),
    SongLengthServiceFacade: vi.fn(() => mockFacade),
}));

import { Filesystem } from '@capacitor/filesystem';
import { base64ToUint8 } from '@/lib/sid/sidUtils';
import {
    ensureHvscSonglengthsReadyOnColdStart,
    reloadHvscSonglengthsOnConfigChange,
    resolveHvscSonglengthDuration,
    getHvscSonglengthsStats,
    resetHvscSonglengths,
    __test__,
} from '@/lib/hvsc/hvscSongLengthService';

describe('hvscSongLengthService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetHvscSonglengths('test-reset');
        vi.mocked(mockFacade.loadOnColdStart).mockResolvedValue(undefined);
        vi.mocked(mockFacade.reloadOnConfigChange).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('ensureHvscSonglengthsReadyOnColdStart', () => {
        it('calls loadOnColdStart on first invocation', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
            await ensureHvscSonglengthsReadyOnColdStart();
            expect(mockFacade.loadOnColdStart).toHaveBeenCalledTimes(1);
        });

        it('is idempotent on second invocation', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
            await ensureHvscSonglengthsReadyOnColdStart();
            await ensureHvscSonglengthsReadyOnColdStart();
            expect(mockFacade.loadOnColdStart).toHaveBeenCalledTimes(1);
        });
    });

    describe('decodeBase64Text', () => {
        it('decodes base64 text when possible', () => {
            const decoded = __test__.decodeBase64Text(btoa('hello'));
            expect(decoded).toBe('hello');
        });

        it('falls back to raw string on decode error', () => {
            vi.mocked(base64ToUint8).mockImplementationOnce(() => {
                throw new Error('decode-failed');
            });
            const decoded = __test__.decodeBase64Text('raw-text');
            expect(decoded).toBe('raw-text');
        });
    });

    describe('discoverSonglengthFiles', () => {
        it('returns md5 before txt and skips missing roots', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: ['Songlengths.txt', 'Songlengths.md5'] } as any)
                .mockRejectedValueOnce(new Error('missing'));
            vi.mocked(Filesystem.stat)
                .mockResolvedValueOnce({ type: 'file' } as any)
                .mockResolvedValueOnce({ type: 'file' } as any);
            vi.mocked(Filesystem.readFile)
                .mockResolvedValueOnce({ data: btoa('md5=0:10') } as any)
                .mockResolvedValueOnce({ data: btoa('txt=0:20') } as any);

            const files = await __test__.discoverSonglengthFiles();

            expect(files).toHaveLength(2);
            expect(files[0].path.toLowerCase().endsWith('.md5')).toBe(true);
            expect(files[1].path.toLowerCase().endsWith('.txt')).toBe(true);
        });

        it('skips stat-missing files without read attempts', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: ['Songlengths.md5'] } as any)
                .mockResolvedValueOnce({ files: [] } as any);
            vi.mocked(Filesystem.stat).mockRejectedValueOnce(new Error('File does not exist'));

            const files = await __test__.discoverSonglengthFiles();

            expect(files).toEqual([]);
            expect(Filesystem.readFile).not.toHaveBeenCalled();
        });

        it('skips non-file stat results', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: ['Songlengths.md5'] } as any)
                .mockResolvedValueOnce({ files: [] } as any);
            vi.mocked(Filesystem.stat).mockResolvedValueOnce({ type: 'directory' } as any);

            const files = await __test__.discoverSonglengthFiles();
            expect(files).toEqual([]);
        });

        it('handles generic stat error gracefully', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: ['Songlengths.md5'] } as any)
                .mockResolvedValueOnce({ files: [] } as any);
            vi.mocked(Filesystem.stat).mockRejectedValueOnce(new Error('I/O error'));

            const files = await __test__.discoverSonglengthFiles();
            expect(files).toEqual([]);
        });

        it('handles readFile disappearance after stat', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: ['Songlengths.md5'] } as any)
                .mockResolvedValueOnce({ files: [] } as any);
            vi.mocked(Filesystem.stat).mockResolvedValueOnce({ type: 'file' } as any);
            vi.mocked(Filesystem.readFile).mockRejectedValueOnce(new Error('File not found'));

            const files = await __test__.discoverSonglengthFiles();
            expect(files).toEqual([]);
        });

        it('handles readFile generic error', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: ['Songlengths.md5'] } as any)
                .mockResolvedValueOnce({ files: [] } as any);
            vi.mocked(Filesystem.stat).mockResolvedValueOnce({ type: 'file' } as any);
            vi.mocked(Filesystem.readFile).mockRejectedValueOnce(new Error('Permission denied'));

            const files = await __test__.discoverSonglengthFiles();
            expect(files).toEqual([]);
        });

        it('handles readdir entries with name property (object entries)', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: [{ name: 'Songlengths.txt' }] } as any)
                .mockResolvedValueOnce({ files: [] } as any);
            vi.mocked(Filesystem.stat).mockResolvedValueOnce({ type: 'file' } as any);
            vi.mocked(Filesystem.readFile).mockResolvedValueOnce({ data: btoa('test') } as any);

            const files = await __test__.discoverSonglengthFiles();
            expect(files).toHaveLength(1);
        });

        it('skips non-matching filenames', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir)
                .mockResolvedValueOnce({ files: ['README.txt', 'Songlengths.md5'] } as any)
                .mockResolvedValueOnce({ files: [] } as any);
            vi.mocked(Filesystem.stat).mockResolvedValueOnce({ type: 'file' } as any);
            vi.mocked(Filesystem.readFile).mockResolvedValueOnce({ data: btoa('md5 data') } as any);

            const files = await __test__.discoverSonglengthFiles();
            expect(files).toHaveLength(1);
        });
    });

    describe('ensureSonglengthDirectory', () => {
        it('handles mkdir errors for missing paths', async () => {
            vi.mocked(Filesystem.mkdir).mockRejectedValueOnce(new Error('does not exist'));
            await __test__.ensureSonglengthDirectory('hvsc/library');
        });

        it('handles mkdir generic errors', async () => {
            vi.mocked(Filesystem.mkdir).mockRejectedValueOnce(new Error('Permission denied'));
            await __test__.ensureSonglengthDirectory('hvsc/library');
        });
    });

    describe('isMissingPathError', () => {
        it('detects missing file errors', () => {
            expect(__test__.isMissingPathError(new Error('File does not exist'))).toBe(true);
            expect(__test__.isMissingPathError(new Error('no such file or directory'))).toBe(true);
            expect(__test__.isMissingPathError(new Error('not found'))).toBe(true);
        });

        it('returns false for non-missing errors', () => {
            expect(__test__.isMissingPathError(new Error('Permission denied'))).toBe(false);
        });

        it('handles nested error objects', () => {
            expect(__test__.isMissingPathError({ error: 'File does not exist' })).toBe(true);
            expect(__test__.isMissingPathError({ error: { message: 'not found' } })).toBe(true);
        });

        it('handles null and undefined', () => {
            expect(__test__.isMissingPathError(null)).toBe(false);
            expect(__test__.isMissingPathError(undefined)).toBe(false);
        });

        it('handles string errors', () => {
            expect(__test__.isMissingPathError('File does not exist')).toBe(true);
        });
    });

    describe('reloadHvscSonglengthsOnConfigChange', () => {
        it('calls reloadOnConfigChange', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
            await reloadHvscSonglengthsOnConfigChange();
            expect(mockFacade.reloadOnConfigChange).toHaveBeenCalledTimes(1);
        });
    });

    describe('resolveHvscSonglengthDuration', () => {
        it('ensures cold-start loaded then delegates to facade', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
            const result = await resolveHvscSonglengthDuration({ virtualPath: '/DEMOS/test.sid' });
            expect(result.durationSeconds).toBe(42);
            expect(mockFacade.resolveDurationSeconds).toHaveBeenCalledWith({ virtualPath: '/DEMOS/test.sid' });
        });
    });

    describe('getHvscSonglengthsStats', () => {
        it('returns facade stats', () => {
            const stats = getHvscSonglengthsStats();
            expect(stats).toEqual({ entries: 10, sources: 1 });
        });
    });

    describe('resetHvscSonglengths', () => {
        it('resets state and allows re-load', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
            await ensureHvscSonglengthsReadyOnColdStart();
            expect(mockFacade.loadOnColdStart).toHaveBeenCalledTimes(1);

            resetHvscSonglengths('test');
            await ensureHvscSonglengthsReadyOnColdStart();
            expect(mockFacade.loadOnColdStart).toHaveBeenCalledTimes(2);
        });
    });

    describe('concurrent load deduplication', () => {
        it('coalesces concurrent calls into a single load', async () => {
            vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
            vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
            let resolveLoad!: () => void;
            mockFacade.reloadOnConfigChange.mockReturnValue(
                new Promise<void>((resolve) => { resolveLoad = resolve; }),
            );

            const p1 = reloadHvscSonglengthsOnConfigChange();
            const p2 = reloadHvscSonglengthsOnConfigChange();

            resolveLoad();
            await Promise.all([p1, p2]);
            expect(mockFacade.reloadOnConfigChange).toHaveBeenCalledTimes(1);
        });
    });
});
