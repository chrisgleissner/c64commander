import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import {
  installOrUpdateHvsc,
  getHvscSong,
  cancelHvscInstall,
} from '@/lib/hvsc/hvscIngestionRuntime';
import {
  fetchLatestHvscVersions,
} from '@/lib/hvsc/hvscReleaseService';
import {
  loadHvscState,
  updateHvscState,
} from '@/lib/hvsc/hvscStateStore';
import {
  writeCachedArchive,
  deleteCachedArchive,
  writeLibraryFile,
} from '@/lib/hvsc/hvscFilesystem';
import { extractArchiveEntries } from '@/lib/hvsc/hvscArchiveExtraction';

// MOCKS
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

vi.mock('@/lib/hvsc/hvscFilesystem', () => ({
  ensureHvscDirs: vi.fn(async () => undefined),
  getHvscCacheDir: vi.fn(() => 'hvsc/cache'),
  listHvscFolder: vi.fn(),
  getHvscSongByVirtualPath: vi.fn(),
  getHvscDurationByMd5: vi.fn(),
  resetLibraryRoot: vi.fn(),
  writeLibraryFile: vi.fn(),
  deleteLibraryFile: vi.fn(),
  resetSonglengthsCache: vi.fn(),
  writeCachedArchive: vi.fn(),
  deleteCachedArchive: vi.fn(),
  readCachedArchiveMarker: vi.fn(),
  writeCachedArchiveMarker: vi.fn(),
}));

vi.mock('@/lib/hvsc/hvscStateStore', () => ({
  loadHvscState: vi.fn(),
  markUpdateApplied: vi.fn(),
  updateHvscState: vi.fn((patch) => patch),
  isUpdateApplied: vi.fn(() => false),
}));

vi.mock('@/lib/hvsc/hvscStatusStore', () => ({
  updateHvscStatusSummaryFromEvent: vi.fn(),
}));

vi.mock('@/lib/hvsc/hvscArchiveExtraction', () => ({
  extractArchiveEntries: vi.fn(),
}));

vi.mock('@/lib/hvsc/hvscReleaseService', () => ({
  buildHvscBaselineUrl: vi.fn(),
  buildHvscUpdateUrl: vi.fn(),
  fetchLatestHvscVersions: vi.fn(),
}));

describe('hvscIngestionRuntime Edge Cases', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
        vi.mocked(loadHvscState).mockReturnValue({
            ingestionState: 'idle',
            installedBaselineVersion: 0,
            installedVersion: 0,
            ingestionError: null
        });
        
        vi.mocked(Filesystem.stat).mockRejectedValue(new Error('File not found'));
        vi.mocked(Filesystem.readFile).mockResolvedValue({ data: '' });
    });

    it('getHvscSong throws explicit error when virtualPath is missing', async () => {
        await expect(getHvscSong({ id: 1 })).rejects.toThrow('Song not found');
    });

    describe('Unstable Network / Native Fallback', () => {
        it('falls back to manual fetch if native download fails with exists error', async () => {
             vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
             vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
                 baselineVersion: 60,
                 updateVersion: 60,
                 baseUrl: 'http://hvsc.de'
             });

             const err = new Error('File already exists'); 
             vi.mocked(Filesystem.downloadFile).mockRejectedValue(err);

             globalThis.fetch = vi.fn().mockResolvedValue({
                 ok: true,
                 headers: { get: () => '100' },
                 arrayBuffer: async () => new ArrayBuffer(100)
             });

             await installOrUpdateHvsc('token-fallback');
             
             expect(Filesystem.downloadFile).toHaveBeenCalled();
             expect(globalThis.fetch).toHaveBeenCalled();
             expect(writeCachedArchive).toHaveBeenCalled();
        });

        it('cleans up partial download on failure', async () => {
             vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
             vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
                 baselineVersion: 10,
                 updateVersion: 10,
                 baseUrl: 'http://foo'
             });
             
             globalThis.fetch = vi.fn().mockRejectedValue(new Error('Total fail'));

             await expect(installOrUpdateHvsc('token-fail')).rejects.toThrow('Total fail');
             expect(deleteCachedArchive).toHaveBeenCalled();
        });

        it('recovers on restart after an interrupted download', async () => {
             vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
                 baselineVersion: 10,
                 updateVersion: 10,
                 baseUrl: 'http://foo'
             });
             vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
                 await onEntry('HVSC/C64Music/DEMO.sid', new Uint8Array([1, 2, 3]));
             });

             globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection lost'));
             await expect(installOrUpdateHvsc('token-interrupt')).rejects.toThrow('Connection lost');
             expect(deleteCachedArchive).toHaveBeenCalled();

             globalThis.fetch = vi.fn()
               .mockResolvedValueOnce({
                 ok: true,
                 status: 200,
                 statusText: 'OK',
                 headers: { get: () => '3' },
               } as any)
               .mockResolvedValueOnce({
                 ok: true,
                 status: 200,
                 statusText: 'OK',
                 headers: { get: () => '3' },
                 body: null,
                 arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
               } as any);

             await expect(installOrUpdateHvsc('token-interrupt-retry')).resolves.toBeDefined();
        });
    });

    describe('Cancellation', () => {
        it('throws if cancelled during operation', async () => {
             vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
                 baselineVersion: 10,
                 updateVersion: 10,
                 baseUrl: 'http://foo'
             });

             globalThis.fetch = vi.fn().mockImplementation(async () => {
                 return {
                     ok: true,
                     arrayBuffer: async () => new ArrayBuffer(10),
                     headers: { get: () => '10' }
                 };
             });

             vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
                 // Wait slightly longer to ensure ensure cancellation is processed
                 await new Promise(r => setTimeout(r, 50));
                 
                 // Mock: calling onEntry (removed log)
                 // Process an entry - this calls ensureNotCancelled
                 await onEntry('HVSC/C64Music/DEMO.sid', new Uint8Array(10));
             });

             const cancelToken = 'token-cancel';
             const p = installOrUpdateHvsc(cancelToken);
             
             await new Promise(r => setTimeout(r, 10)); // Yield to let install start
             await cancelHvscInstall(cancelToken);
             
             await expect(p).rejects.toThrow();
        });
    });

    it('handles songlengths.md5 and .gma files correctly', async () => {
         vi.mocked(fetchLatestHvscVersions).mockResolvedValue({ baselineVersion: 10, updateVersion: 10, baseUrl: '' });
         globalThis.fetch = vi.fn().mockResolvedValue({
             ok: true,
             arrayBuffer: async () => new ArrayBuffer(10),
             headers: { get: () => '10' }
         });
         
         vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
             const md5Data = new TextEncoder().encode('some-data');
             await onEntry('HVSC/C64Music/DOCUMENTS/Songlengths.md5', md5Data);
         });

         await installOrUpdateHvsc('token-md5');
         
         expect(writeLibraryFile).toHaveBeenCalledWith('/DOCUMENTS/Songlengths.md5', expect.anything());
    });

    it('recovers on restart after extraction failure', async () => {
         vi.mocked(fetchLatestHvscVersions).mockResolvedValue({ baselineVersion: 10, updateVersion: 10, baseUrl: '' });
         globalThis.fetch = vi.fn()
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
           } as any)
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
             body: null,
             arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
           } as any);
         vi.mocked(extractArchiveEntries).mockRejectedValueOnce(new Error('Corrupt archive'));

         await expect(installOrUpdateHvsc('token-corrupt')).rejects.toThrow('Corrupt archive');

         vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
           await onEntry('HVSC/C64Music/DEMO.sid', new Uint8Array([1, 2, 3]));
         });
         globalThis.fetch = vi.fn()
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
           } as any)
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
             body: null,
             arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
           } as any);

         await expect(installOrUpdateHvsc('token-corrupt-retry')).resolves.toBeDefined();
    });

    it('recovers on restart after ingestion write failure', async () => {
         vi.mocked(fetchLatestHvscVersions).mockResolvedValue({ baselineVersion: 10, updateVersion: 10, baseUrl: '' });
         globalThis.fetch = vi.fn()
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
           } as any)
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
             body: null,
             arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
           } as any);
         vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
             await onEntry('HVSC/C64Music/DEMO.sid', new Uint8Array([1, 2, 3]));
         });
         vi.mocked(writeLibraryFile).mockRejectedValueOnce(new Error('Write failed'));

         await expect(installOrUpdateHvsc('token-write-fail')).rejects.toThrow('Write failed');

         vi.mocked(writeLibraryFile).mockResolvedValue(undefined);
         globalThis.fetch = vi.fn()
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
           } as any)
           .mockResolvedValueOnce({
             ok: true,
             status: 200,
             statusText: 'OK',
             headers: { get: () => '10' },
             body: null,
             arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
           } as any);

         await expect(installOrUpdateHvsc('token-write-fail-retry')).resolves.toBeDefined();
    });
});
