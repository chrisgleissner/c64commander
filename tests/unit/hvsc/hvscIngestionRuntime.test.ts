import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import {
  addHvscProgressListener,
  cancelHvscInstall,
  checkForHvscUpdates,
  getHvscCacheStatus,
  getHvscFolderListing,
  getHvscSong,
  getHvscDurationByMd5Seconds,
  installOrUpdateHvsc,
  ingestCachedHvsc,
} from '@/lib/hvsc/hvscIngestionRuntime';
import { isUpdateApplied, loadHvscState, updateHvscState } from '@/lib/hvsc/hvscStateStore';
import { fetchLatestHvscVersions } from '@/lib/hvsc/hvscReleaseService';
import { getHvscDurationByMd5, getHvscSongByVirtualPath, listHvscFolder } from '@/lib/hvsc/hvscFilesystem';
import { deleteLibraryFile, resetLibraryRoot, resetSonglengthsCache, writeLibraryFile, readCachedArchiveMarker } from '@/lib/hvsc/hvscFilesystem';
import { extractArchiveEntries } from '@/lib/hvsc/hvscArchiveExtraction';

if (!(vi as typeof vi & { mocked?: <T>(value: T) => T }).mocked) {
  (vi as typeof vi & { mocked: <T>(value: T) => T }).mocked = (value) => value;
}

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    downloadFile: vi.fn(),
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
  readCachedArchiveMarker: vi.fn(async () => ({ version: 5, type: 'baseline' })),
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

vi.mock('@/lib/sid/sidUtils', () => ({
  base64ToUint8: vi.fn(() => new Uint8Array()),
}));

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

describe('hvscIngestionRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ['hvsc-baseline-5.complete.json'],
    });
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: 'AA==' } as any);
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: 123, type: 'file' } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    });
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({ version: 5, type: 'baseline' } as any);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    if (!globalThis.crypto) {
      (globalThis as typeof globalThis & { crypto?: Crypto }).crypto = {
        randomUUID: () => 'uuid',
      } as Crypto;
    }
  });

  afterEach(() => {
    // vitest environment cleanup handled by reset/restore calls above.
  });

  it('skips cached ingest when no newer archives exist', async () => {
    const events: Array<{ message?: string }> = [];
    const listener = await addHvscProgressListener((event) => {
      events.push(event);
    });

    const status = await ingestCachedHvsc('token');
    await listener.remove();

    expect(status.installedVersion).toBe(5);
    expect(events.some((event) => event.message === 'No new HVSC archives to ingest')).toBe(true);
  });

  it('summarizes cached archive versions', async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: [
        'hvsc-baseline-84.complete.json',
        'hvsc-update-85.complete.json',
        { name: 'hvsc-update-86.complete.json' },
      ],
    } as any);

    const status = await getHvscCacheStatus();

    expect(status.baselineVersion).toBe(84);
    expect(status.updateVersions).toEqual([85, 86]);
  });

  it('returns empty cache status when cache directory is missing', async () => {
    vi.mocked(Filesystem.readdir).mockRejectedValue(new Error('no dir'));

    const status = await getHvscCacheStatus();

    expect(status).toEqual({ baselineVersion: null, updateVersions: [] });
  });

  it('calculates required update versions', async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({ baselineVersion: 84, updateVersion: 86 } as any);
    vi.mocked(updateHvscState).mockReturnValue({ installedVersion: 84 } as any);

    const result = await checkForHvscUpdates();

    expect(result.requiredUpdates).toEqual([85, 86]);
  });

  it('returns folder listings from the HVSC filesystem', async () => {
    vi.mocked(listHvscFolder).mockResolvedValue({
      path: '/ROOT',
      folders: [{ path: '/ROOT/DEMOS', name: 'DEMOS' }],
      songs: [],
    } as any);

    const listing = await getHvscFolderListing('/ROOT');

    expect(listing.folders).toHaveLength(1);
  });

  it('resolves HVSC songs by virtual path', async () => {
    vi.mocked(getHvscSongByVirtualPath).mockResolvedValue({
      id: 1,
      title: 'Demo',
      path: '/demo.sid',
      data: new Uint8Array([1, 2, 3]),
    } as any);

    const song = await getHvscSong({ virtualPath: '/demo.sid' });

    expect(song.title).toBe('Demo');
  });

  it('throws when HVSC song is missing', async () => {
    vi.mocked(getHvscSongByVirtualPath).mockResolvedValue(null as any);

    await expect(getHvscSong({ virtualPath: '/missing.sid' })).rejects.toThrow('Song not found');
    await expect(getHvscSong({})).rejects.toThrow('Song not found');
  });

  it('passes through duration lookups', async () => {
    vi.mocked(getHvscDurationByMd5).mockResolvedValue(120);

    await expect(getHvscDurationByMd5Seconds('abc')).resolves.toBe(120);
  });

  it('allows cancellation tokens to be reused', async () => {
    await expect(cancelHvscInstall('token-1')).resolves.toBeUndefined();
    await expect(cancelHvscInstall('token-1')).resolves.toBeUndefined();
  });

  it('installs baseline from cached archive without downloading', async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: 'https://example.com',
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: 'ready',
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEnumerate, onProgress, onEntry }) => {
      onEnumerate?.(3);
      onProgress?.(1, 3);
      await onEntry?.('HVSC/DELETE.TXT', new TextEncoder().encode('demo.sid\n'));
      await onEntry?.('HVSC/C64Music/songlengths.txt', new TextEncoder().encode('demo.sid=0:30'));
      await onEntry?.('HVSC/C64Music/Demo/demo.sid', new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc('token-install');

    expect(resetLibraryRoot).toHaveBeenCalled();
    expect(writeLibraryFile).toHaveBeenCalled();
    expect(deleteLibraryFile).toHaveBeenCalledWith('/demo.sid');
    expect(resetSonglengthsCache).toHaveBeenCalled();
  });

  it('downloads archives via fetch when cache is missing', async () => {
    const originalEnv = process.env.VITE_ENABLE_TEST_PROBES;
    process.env.VITE_ENABLE_TEST_PROBES = '1';
    const originalFetch = globalThis.fetch;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => '2' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => '2' },
        body: { getReader: () => reader },
        arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      });

    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: 'https://example.com',
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error('missing'));
    vi.mocked(readCachedArchiveMarker).mockResolvedValue(null as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.('HVSC/C64Music/Demo/demo.sid', new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc('token-download');

    expect(globalThis.fetch).toHaveBeenCalled();

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    if (originalEnv === undefined) {
      delete process.env.VITE_ENABLE_TEST_PROBES;
    } else {
      process.env.VITE_ENABLE_TEST_PROBES = originalEnv;
    }
  });

  it('emits incremental download progress during streaming fetch', async () => {
    const originalEnv = process.env.VITE_ENABLE_TEST_PROBES;
    process.env.VITE_ENABLE_TEST_PROBES = '1';
    const originalFetch = globalThis.fetch;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([3, 4]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => '4' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => '4' },
        body: { getReader: () => reader },
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      });

    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: 'https://example.com',
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error('missing'));
    vi.mocked(readCachedArchiveMarker).mockResolvedValue(null as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.('HVSC/C64Music/Demo/demo.sid', new Uint8Array([1, 2, 3]));
    });

    const progressEvents: Array<{ downloadedBytes?: number | null }> = [];
    const listener = await addHvscProgressListener((event) => {
      if (event.stage === 'download') {
        progressEvents.push({ downloadedBytes: event.downloadedBytes ?? null });
      }
    });

    await installOrUpdateHvsc('token-download-progress');
    await listener.remove();

    expect(progressEvents.length).toBeGreaterThan(1);
    expect(progressEvents[0]?.downloadedBytes ?? 0).toBeLessThan(progressEvents.at(-1)?.downloadedBytes ?? 0);

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    if (originalEnv === undefined) {
      delete process.env.VITE_ENABLE_TEST_PROBES;
    } else {
      process.env.VITE_ENABLE_TEST_PROBES = originalEnv;
    }
  });

  it('skips install when already up to date', async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: 'https://example.com',
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);

    const status = await installOrUpdateHvsc('token-noop');

    expect(status.installedVersion).toBe(5);
  });

  it('uses native download when available', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => '1024' },
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: 'https://example.com',
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error('missing'));
    vi.mocked(readCachedArchiveMarker).mockResolvedValue(null as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.('HVSC/C64Music/Demo/demo.sid', new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc('token-native');

    expect(Filesystem.downloadFile).toHaveBeenCalled();

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  it('rejects cached ingest when baseline is missing', async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);

    await expect(ingestCachedHvsc('token-missing')).rejects.toThrow('No cached HVSC archives available');
  });

  it('ingests cached baseline and updates', async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ['hvsc-baseline-5.complete.json', 'hvsc-update-6.complete.json'],
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({ version: 5, type: 'baseline' } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.('HVSC/DELETE.TXT', new TextEncoder().encode('demo.sid\n'));
      await onEntry?.('HVSC/C64Music/songlengths.txt', new TextEncoder().encode('demo.sid=0:30'));
      await onEntry?.('HVSC/C64Music/Demo/demo.sid', new Uint8Array([1, 2, 3]));
    });

    await ingestCachedHvsc('token-cached');

    expect(writeLibraryFile).toHaveBeenCalled();
    expect(deleteLibraryFile).toHaveBeenCalledWith('/demo.sid');
  });

  it('skips applied updates during cached ingest', async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ['hvsc-baseline-5.complete.json', 'hvsc-update-6.complete.json'],
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(isUpdateApplied).mockReturnValue(true);

    await ingestCachedHvsc('token-skip');

    expect(extractArchiveEntries).not.toHaveBeenCalled();
  });
});
