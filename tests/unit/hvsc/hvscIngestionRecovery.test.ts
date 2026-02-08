import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  Capacitor: { isNativePlatform: vi.fn(() => false) },
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

const mockLoadState = vi.fn();
const mockUpdateState = vi.fn((patch) => patch);
const mockMarkUpdateApplied = vi.fn();
const mockIsUpdateApplied = vi.fn(() => false);

vi.mock('@/lib/hvsc/hvscStateStore', () => ({
  loadHvscState: (...args: unknown[]) => mockLoadState(...args),
  updateHvscState: (...args: unknown[]) => mockUpdateState(...args),
  markUpdateApplied: (...args: unknown[]) => mockMarkUpdateApplied(...args),
  isUpdateApplied: (...args: unknown[]) => mockIsUpdateApplied(...args),
}));

const mockLoadSummary = vi.fn();
const mockSaveSummary = vi.fn();
const mockUpdateSummaryFromEvent = vi.fn();

vi.mock('@/lib/hvsc/hvscStatusStore', () => ({
  updateHvscStatusSummaryFromEvent: (...args: unknown[]) => mockUpdateSummaryFromEvent(...args),
  loadHvscStatusSummary: (...args: unknown[]) => mockLoadSummary(...args),
  saveHvscStatusSummary: (...args: unknown[]) => mockSaveSummary(...args),
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

vi.mock('@/lib/hvsc/hvscSongLengthService', () => ({
  reloadHvscSonglengthsOnConfigChange: vi.fn(async () => undefined),
}));

import { recoverStaleIngestionState, isIngestionRuntimeActive } from '@/lib/hvsc/hvscIngestionRuntime';

describe('recoverStaleIngestionState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets installing state to error on cold start', () => {
    mockLoadState.mockReturnValue({
      installedVersion: 0,
      ingestionState: 'installing',
      ingestionError: null,
      updates: {},
    });
    mockLoadSummary.mockReturnValue({
      download: { status: 'in-progress' },
      extraction: { status: 'idle' },
      lastUpdatedAt: null,
    });

    const result = recoverStaleIngestionState();

    expect(result).toBe(true);
    expect(mockUpdateState).toHaveBeenCalledWith({
      ingestionState: 'error',
      ingestionError: 'Interrupted by app restart',
    });
    expect(mockSaveSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        download: expect.objectContaining({ status: 'failure', errorMessage: 'Interrupted by app restart' }),
        extraction: { status: 'idle' },
      }),
    );
  });

  it('resets updating state to error on cold start', () => {
    mockLoadState.mockReturnValue({
      installedVersion: 5,
      ingestionState: 'updating',
      ingestionError: null,
      updates: {},
    });
    mockLoadSummary.mockReturnValue({
      download: { status: 'success' },
      extraction: { status: 'in-progress' },
      lastUpdatedAt: null,
    });

    const result = recoverStaleIngestionState();

    expect(result).toBe(true);
    expect(mockUpdateState).toHaveBeenCalledWith({
      ingestionState: 'error',
      ingestionError: 'Interrupted by app restart',
    });
    expect(mockSaveSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        download: { status: 'success' },
        extraction: expect.objectContaining({ status: 'failure', errorMessage: 'Interrupted by app restart' }),
      }),
    );
  });

  it('does not reset idle state', () => {
    mockLoadState.mockReturnValue({
      installedVersion: 0,
      ingestionState: 'idle',
      ingestionError: null,
      updates: {},
    });

    const result = recoverStaleIngestionState();

    expect(result).toBe(false);
    expect(mockUpdateState).not.toHaveBeenCalled();
  });

  it('does not reset ready state', () => {
    mockLoadState.mockReturnValue({
      installedVersion: 5,
      ingestionState: 'ready',
      ingestionError: null,
      updates: {},
    });

    const result = recoverStaleIngestionState();

    expect(result).toBe(false);
    expect(mockUpdateState).not.toHaveBeenCalled();
  });

  it('does not reset error state', () => {
    mockLoadState.mockReturnValue({
      installedVersion: 0,
      ingestionState: 'error',
      ingestionError: 'Previous error',
      updates: {},
    });

    const result = recoverStaleIngestionState();

    expect(result).toBe(false);
    expect(mockUpdateState).not.toHaveBeenCalled();
  });

  it('skips summary save when no steps are in-progress', () => {
    mockLoadState.mockReturnValue({
      installedVersion: 0,
      ingestionState: 'installing',
      ingestionError: null,
      updates: {},
    });
    mockLoadSummary.mockReturnValue({
      download: { status: 'idle' },
      extraction: { status: 'idle' },
      lastUpdatedAt: null,
    });

    const result = recoverStaleIngestionState();

    expect(result).toBe(true);
    expect(mockUpdateState).toHaveBeenCalled();
    expect(mockSaveSummary).not.toHaveBeenCalled();
  });

  it('isIngestionRuntimeActive returns false when no ingestion running', () => {
    expect(isIngestionRuntimeActive()).toBe(false);
  });
});
