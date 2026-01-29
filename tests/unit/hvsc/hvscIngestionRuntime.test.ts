import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';
import { addHvscProgressListener, ingestCachedHvsc } from '@/lib/hvsc/hvscIngestionRuntime';
import { loadHvscState } from '@/lib/hvsc/hvscStateStore';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
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
}));

describe('hvscIngestionRuntime', () => {
  beforeEach(() => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ['hvsc-baseline-5.complete.json'],
    });
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: 'idle',
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    });
    if (!globalThis.crypto) {
      (globalThis as typeof globalThis & { crypto?: Crypto }).crypto = {
        randomUUID: () => 'uuid',
      } as Crypto;
    }
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
});
