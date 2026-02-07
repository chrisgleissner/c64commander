import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';

// 1. Define mocks BEFORE importing modules that use them
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        downloadFile: vi.fn(),
        stat: vi.fn(),
        readFile: vi.fn(),
        readdir: vi.fn(),
        mkdir: vi.fn(),
        deleteFile: vi.fn(),
        writeFile: vi.fn(),
    },
    Directory: {
        Data: 'DATA'
    }
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false),
    },
}));

vi.mock('../../../src/lib/hvsc/hvscReleaseService', () => ({
    fetchLatestHvscVersions: vi.fn(),
    buildHvscBaselineUrl: vi.fn((v, base) => `${base}/full${v}.7z`),
    buildHvscUpdateUrl: vi.fn((v, base) => `${base}/update${v}.7z`),
}));

vi.mock('../../../src/lib/hvsc/hvscFilesystem', () => ({
    deleteLibraryFile: vi.fn(),
    ensureHvscDirs: vi.fn(),
    getHvscCacheDir: vi.fn(),
    getHvscLibraryDir: vi.fn(),
    listHvscFolder: vi.fn(),
    readCachedArchive: vi.fn(),
    readCachedArchiveMarker: vi.fn(),
    resolveLibraryPath: vi.fn(),
    writeCachedArchive: vi.fn(),
    writeCachedArchiveMarker: vi.fn(),
    writeLibraryFile: vi.fn(),
    deleteCachedArchive: vi.fn(),
    resetLibraryRoot: vi.fn(),
    resetSonglengthsCache: vi.fn(),
    getHvscSongByVirtualPath: vi.fn(),
    getHvscDurationByMd5: vi.fn(),
}));

vi.mock('../../../src/lib/hvsc/hvscArchiveExtraction', () => ({
    extractArchiveEntries: vi.fn().mockImplementation(async ({ onEntry, onEnumerate, onProgress }) => {
        if (onEnumerate) onEnumerate(2);
        if (onProgress) onProgress(0, 2);
        await onEntry('HVSC/C64Music/DEMOS/foo.sid', new Uint8Array([1]));
        await onEntry('HVSC/DOCUMENTS/songlengths.txt', new Uint8Array([1]));
        await onEntry('HVSC/C64Music/DOCUMENTS/delete.txt', new TextEncoder().encode('DEMOS/old.sid\n/DEMOS/gone.sid'));
        if (onProgress) onProgress(2, 2);
    }),
}));

vi.mock('../../../src/lib/hvsc/hvscStateStore', () => ({
    loadHvscState: vi.fn().mockReturnValue({ ingestionState: 'idle' }),
    markUpdateApplied: vi.fn(),
    updateHvscState: vi.fn(),
    isUpdateApplied: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/lib/logging', () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

// 2. Import modules dynamically or after mocks
// Since we are in ESM, we can't easily delay top-level imports if they are static.
// But we can use `await import` in tests.
// However, to make it clean, we can move this entire test file content into a block or use dynamic import.

describe('hvscIngestionRuntime Coverage Gap Fillers', () => {
    let hvscIngestionRuntime: any;
    let hvscReleaseService: any;
    let hvscStateStore: any;
    let hvscFilesystem: any;
    let hvscArchiveExtraction: any;

    beforeEach(async () => {
        vi.resetAllMocks();
        (global as any).fetch = vi.fn();

        // Dynamic import to ensure mocks are applied
        hvscReleaseService = await import('../../../src/lib/hvsc/hvscReleaseService');
        hvscStateStore = await import('../../../src/lib/hvsc/hvscStateStore');
        hvscFilesystem = await import('../../../src/lib/hvsc/hvscFilesystem');
        hvscArchiveExtraction = await import('../../../src/lib/hvsc/hvscArchiveExtraction');
        hvscIngestionRuntime = await import('../../../src/lib/hvsc/hvscIngestionRuntime');

        (hvscStateStore.loadHvscState as any).mockReturnValue({ ingestionState: 'idle' });
        (Capacitor.isNativePlatform as any).mockReturnValue(false);
        (hvscArchiveExtraction.extractArchiveEntries as any).mockImplementation(
            async ({ onEntry, onEnumerate, onProgress }: any) => {
                if (onEnumerate) onEnumerate(2);
                if (onProgress) onProgress(0, 2);
                await onEntry('HVSC/C64Music/DEMOS/foo.sid', new Uint8Array([1]));
                await onEntry('HVSC/DOCUMENTS/songlengths.txt', new Uint8Array([1]));
                await onEntry('HVSC/C64Music/DOCUMENTS/delete.txt', new TextEncoder().encode('DEMOS/old.sid\n/DEMOS/gone.sid'));
                if (onProgress) onProgress(2, 2);
            }
        );
    });

    it('reports not ingesting when idle', async () => {
        const status = await hvscIngestionRuntime.getHvscStatus();
        expect(status).toBeDefined();
        expect(status.ingestionState).toBe('idle');
    });

    it('simulates native download path', async () => {
        (Capacitor.isNativePlatform as any).mockReturnValue(true);
        (hvscReleaseService.fetchLatestHvscVersions as any).mockResolvedValue({
            full: { version: 80, url: 'http://foo/full.7z' },
            update: { version: 80, url: 'http://foo/update.7z' },
            versions: [80],
            baselineVersion: 80,
            updateVersion: 80,
            baseUrl: 'http://foo'
        } as any);
        (Filesystem.downloadFile as any).mockResolvedValue({ path: 'local/full.7z' });
        (Filesystem.stat as any).mockResolvedValue({ size: 100 } as any);
        (Filesystem.readFile as any).mockResolvedValue({ data: 'AAE=' });

        await hvscIngestionRuntime.installOrUpdateHvsc('token');

        expect(Capacitor.isNativePlatform).toHaveBeenCalled();
        expect(Filesystem.downloadFile).toHaveBeenCalled();
    });

    it('handles content length parsing', async () => {
        (global as any).fetch.mockResolvedValue({
            ok: true,
            headers: { get: (k: string) => k === 'content-length' ? '123' : null },
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(123)),
            body: null
        });
        (Filesystem.readFile as any).mockResolvedValue({ data: 'AAE=' });

        (hvscReleaseService.fetchLatestHvscVersions as any).mockResolvedValue({
            full: { version: 81, url: 'http://foo/full81.7z' },
            update: { version: 81, url: 'http://foo/update81.7z' },
            versions: [81],
            baselineVersion: 81,
            updateVersion: 81,
            baseUrl: 'http://foo'
        } as any);

        await hvscIngestionRuntime.installOrUpdateHvsc('token2');

        expect(global.fetch).toHaveBeenCalledWith('http://foo/full81.7z', expect.objectContaining({ method: 'HEAD' }));
        expect(global.fetch).toHaveBeenCalledTimes(2);
        // Verify second call is GET with no-store
        const calls = (global as any).fetch.mock.calls;
        const mainFetch = calls.find((c: any) => !c[1].method || c[1].method === 'GET');
        expect(mainFetch).toBeDefined();
        expect(mainFetch[1]).toEqual({ cache: 'no-store' });
    });

    it('ingests cached HVSC with deletions', async () => {
        (Filesystem.readdir as any).mockResolvedValue({
            files: [
                { name: 'hvsc-baseline-80.7z', type: 'file', mtime: 0, uri: '', size: 0, ctime: 0 },
                { name: 'hvsc-baseline-80.complete.json', type: 'file', mtime: 0, uri: '', size: 0, ctime: 0 }
            ]
        });
        (hvscFilesystem.getHvscCacheDir as any).mockReturnValue('hvsc_cache');
        (Filesystem.stat as any).mockResolvedValue({ size: 100, type: 'file' } as any);
        // Mock archive read for cached ingestion
        (Filesystem.readFile as any).mockResolvedValue({ data: 'AAE=' });
        // Ensure cached archive helpers are set for resolution
        (hvscFilesystem.readCachedArchive as any).mockResolvedValue(new Uint8Array(10));

        (hvscFilesystem.readCachedArchiveMarker as any).mockResolvedValue({
            version: 80,
            type: 'baseline',
            filename: 'hvsc-baseline-80.7z',
            processed: false // Force processing
        });

        await hvscIngestionRuntime.ingestCachedHvsc('token3');

        expect(hvscFilesystem.deleteLibraryFile).toHaveBeenCalledWith('/DEMOS/gone.sid');
    });
});
